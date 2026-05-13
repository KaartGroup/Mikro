#!/usr/bin/env python3
"""
Transcription API — async server-side Whisper transcription.

Upload flow:
1. Accept audio file upload
2. Store file in DO Spaces
3. Create TranscriptionJob row in DB (status=queued)
4. Return jobId immediately

The background worker picks up queued jobs, transcribes with
faster-whisper, and stores results back in the DB.

Frontend polls GET /result?jobId=X to check progress.
"""

import json
import os
import uuid
import tempfile
import boto3
from botocore.exceptions import ClientError
from flask.views import MethodView
from flask import request, current_app, g

from ..utils import requires_admin, requires_team_admin_or_above
from ..auth import is_org_admin_or_above, team_admin_visible_user_ids


def _get_s3_client():
    """Create a boto3 S3 client for DO Spaces."""
    return boto3.client(
        "s3",
        endpoint_url=current_app.config.get("DO_SPACES_ENDPOINT"),
        aws_access_key_id=current_app.config.get("DO_SPACES_KEY"),
        aws_secret_access_key=current_app.config.get("DO_SPACES_SECRET"),
        region_name=current_app.config.get("DO_SPACES_REGION"),
    )


# ──────────────────────────────────────────────────────────────────────
# Spaces CORS configuration — permanent home.
#
# Runs once per Flask process on the first upload_init call. This IS
# the canonical place we manage Mikro's CORS rules on the shared
# `kaart` Spaces bucket — NOT a temporary shim.
#
# Why in-code instead of the DO dashboard: browsers need
# `ExposeHeaders: ETag` to read each multipart chunk's ETag out of the
# PUT response (required to finalise multipart uploads). The DO Spaces
# web UI has no field for ExposeHeaders — it can only be set via the
# S3 API. So we set it from here on cold start.
#
# Idempotent: preserves any existing rules owned by other Kaart apps
# (identified by non-overlapping AllowedOrigins), and only upserts
# rules whose origins match our own set.
# ──────────────────────────────────────────────────────────────────────

_CORS_CONFIGURED = False

_MIKRO_CORS_RULES = [
    {
        "ID": "mikro-transcribe-prod",
        "AllowedOrigins": ["https://mikro.kaart.com"],
        "AllowedMethods": ["GET", "PUT", "HEAD"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3000,
    },
    {
        "ID": "mikro-transcribe-dev",
        "AllowedOrigins": ["http://localhost:3000"],
        "AllowedMethods": ["GET", "PUT", "HEAD"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3000,
    },
]

_MIKRO_CORS_ORIGINS = {o for rule in _MIKRO_CORS_RULES for o in rule["AllowedOrigins"]}


def _ensure_bucket_cors():
    """Merge Mikro CORS rules into the shared bucket. Runs once per process."""
    global _CORS_CONFIGURED
    if _CORS_CONFIGURED:
        return

    bucket = current_app.config.get("DO_SPACES_BUCKET")
    if not bucket:
        current_app.logger.warning("Spaces CORS config skipped: DO_SPACES_BUCKET unset")
        return

    s3 = _get_s3_client()

    try:
        resp = s3.get_bucket_cors(Bucket=bucket)
        existing = resp.get("CORSRules", [])
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchCORSConfiguration", "NoSuchCORSConfigurationError"):
            existing = []
        else:
            current_app.logger.error(f"Spaces CORS config: get_bucket_cors failed: {e}")
            return

    preserved = [
        rule for rule in existing
        if not (set(rule.get("AllowedOrigins", [])) & _MIKRO_CORS_ORIGINS)
    ]
    # Our rules MUST come first: S3 CORS evaluates rules top-down and the
    # first rule whose AllowedOrigins+AllowedMethods match wins. If another
    # app has a permissive wildcard rule, putting ours last means ours
    # never matches and ExposeHeaders: ETag is effectively ignored.
    merged = _MIKRO_CORS_RULES + preserved

    try:
        s3.put_bucket_cors(
            Bucket=bucket,
            CORSConfiguration={"CORSRules": merged},
        )
        _CORS_CONFIGURED = True
        current_app.logger.info(
            f"Spaces CORS config: applied {len(merged)} rule(s) to '{bucket}' "
            f"(mikro={len(_MIKRO_CORS_RULES)} first, preserved={len(preserved)})"
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "<unknown>")
        current_app.logger.error(
            f"Spaces CORS config: put_bucket_cors FAILED code={code} err={e}"
        )


MAX_FILE_BYTES = 1024 * 1024 * 1024  # 1 GB hard cap
PART_SIZE = 10 * 1024 * 1024          # 10 MB per part


class TranscriptionAPI(MethodView):
    """Transcription API endpoints."""

    def post(self, path: str):
        if path == "upload-init":
            return self.upload_init()
        if path == "upload-complete":
            return self.upload_complete()
        if path == "upload-abort":
            return self.upload_abort()
        if path == "cancel":
            return self.cancel()
        if path == "cors-apply":
            return self.cors_apply()
        if path == "ai":
            return self.ai_action()
        if path == "update":
            return self.update_job()
        if path == "delete":
            return self.delete_jobs()
        return {"message": "Unknown path", "status": 404}

    def get(self, path: str):
        if path == "status":
            return self.status()
        elif path == "result":
            return self.result()
        elif path == "recent":
            return self.recent()
        elif path == "cors-status":
            return self.cors_status()
        elif path == "list":
            return self.list_jobs()
        elif path == "tags":
            return self.list_tags()
        return {"message": "Unknown path", "status": 404}

    @requires_team_admin_or_above
    def upload_init(self):
        """
        Start a multipart upload direct to DO Spaces.
        Returns uploadId + presigned PUT URLs, one per part.
        """
        _ensure_bucket_cors()

        body = request.get_json(silent=True) or {}
        file_name = body.get("fileName") or "audio.m4a"
        file_size = body.get("fileSize")
        content_type = body.get("contentType") or "application/octet-stream"

        if not isinstance(file_size, int) or file_size <= 0:
            return {"message": "fileSize (positive integer) required", "status": 400}
        if file_size > MAX_FILE_BYTES:
            return {
                "message": f"File exceeds {MAX_FILE_BYTES // (1024 * 1024)} MB limit",
                "status": 413,
            }

        ext = os.path.splitext(file_name)[1] or ".m4a"
        job_id = str(uuid.uuid4())[:8]
        spaces_key = f"mikro/transcriptions/{job_id}{ext}"
        bucket = current_app.config.get("DO_SPACES_BUCKET")

        s3 = _get_s3_client()

        try:
            resp = s3.create_multipart_upload(
                Bucket=bucket,
                Key=spaces_key,
                ContentType=content_type,
            )
            upload_id = resp["UploadId"]
        except Exception as e:
            current_app.logger.error(f"create_multipart_upload failed: {e}")
            return {"message": f"Failed to start upload: {str(e)}", "status": 500}

        part_count = (file_size + PART_SIZE - 1) // PART_SIZE
        try:
            part_urls = [
                s3.generate_presigned_url(
                    "upload_part",
                    Params={
                        "Bucket": bucket,
                        "Key": spaces_key,
                        "UploadId": upload_id,
                        "PartNumber": n,
                    },
                    ExpiresIn=3600,
                )
                for n in range(1, part_count + 1)
            ]
        except Exception as e:
            current_app.logger.error(f"generate_presigned_url failed: {e}")
            # Best-effort abort so we don't leak an orphan upload
            try:
                s3.abort_multipart_upload(Bucket=bucket, Key=spaces_key, UploadId=upload_id)
            except Exception:
                pass
            return {"message": f"Failed to sign upload URLs: {str(e)}", "status": 500}

        current_app.logger.info(
            f"[transcribe-upload] init job_id={job_id} parts={part_count} "
            f"size={file_size} key={spaces_key}"
        )

        return {
            "jobId": job_id,
            "uploadId": upload_id,
            "spacesKey": spaces_key,
            "partSize": PART_SIZE,
            "partCount": part_count,
            "partUrls": part_urls,
            "status": 200,
        }

    @requires_team_admin_or_above
    def upload_complete(self):
        """Finalise the multipart upload and queue a transcription job."""
        from ..database import db, TranscriptionJob

        body = request.get_json(silent=True) or {}
        upload_id = body.get("uploadId")
        spaces_key = body.get("spacesKey")
        job_id = body.get("jobId")
        file_name = body.get("fileName") or "audio.m4a"
        parts = body.get("parts") or []

        if not all([upload_id, spaces_key, job_id]) or not parts:
            return {"message": "uploadId, spacesKey, jobId, parts required", "status": 400}

        bucket = current_app.config.get("DO_SPACES_BUCKET")
        endpoint = current_app.config.get("DO_SPACES_ENDPOINT")

        s3 = _get_s3_client()

        normalised_parts = sorted(
            ({"PartNumber": int(p["PartNumber"]), "ETag": p["ETag"]} for p in parts),
            key=lambda p: p["PartNumber"],
        )

        try:
            s3.complete_multipart_upload(
                Bucket=bucket,
                Key=spaces_key,
                UploadId=upload_id,
                MultipartUpload={"Parts": normalised_parts},
            )
        except Exception as e:
            current_app.logger.error(f"complete_multipart_upload failed: {e}")
            return {"message": f"Failed to finalise upload: {str(e)}", "status": 500}

        file_url = f"{endpoint}/{bucket}/{spaces_key}"

        job = TranscriptionJob(
            id=job_id,
            user_id=g.user.id,
            org_id=getattr(g.user, "org_id", None),
            status="queued",
            file_name=file_name,
            file_url=file_url,
        )
        db.session.add(job)
        db.session.commit()

        current_app.logger.info(
            f"[transcribe-upload] complete job_id={job_id} parts={len(normalised_parts)} "
            f"url={file_url}"
        )

        return {
            "message": "Transcription queued",
            "jobId": job_id,
            "status": 200,
        }

    @requires_team_admin_or_above
    def upload_abort(self):
        """Abort an in-flight multipart upload so Spaces doesn't retain partial data."""
        body = request.get_json(silent=True) or {}
        upload_id = body.get("uploadId")
        spaces_key = body.get("spacesKey")

        if not upload_id or not spaces_key:
            return {"message": "uploadId and spacesKey required", "status": 400}

        bucket = current_app.config.get("DO_SPACES_BUCKET")
        s3 = _get_s3_client()

        try:
            s3.abort_multipart_upload(Bucket=bucket, Key=spaces_key, UploadId=upload_id)
        except Exception as e:
            current_app.logger.warning(f"abort_multipart_upload failed (non-fatal): {e}")

        current_app.logger.info(
            f"[transcribe-upload] abort upload_id={upload_id} key={spaces_key}"
        )

        return {"status": 200}

    @requires_team_admin_or_above
    def cancel(self):
        """
        Mark a queued/transcribing job as cancelled so the frontend can move
        on and the worker's one-at-a-time lock is released.

        Does not kill an in-flight faster-whisper call — the worker checks
        the job status between segments and bails out. Worst case: the
        worker finishes the current segment, sees status=error, exits.
        """
        from ..database import db, TranscriptionJob

        from datetime import datetime, timezone

        body = request.get_json(silent=True) or {}
        job_id = body.get("jobId")
        if not job_id:
            return {"message": "jobId required", "status": 400}

        job = TranscriptionJob.query.get(job_id)
        if not job:
            return {"message": "Job not found", "status": 404}
        if job.user_id != g.user.id and not is_org_admin_or_above(g.user):
            scope = team_admin_visible_user_ids(g.user)
            if job.user_id not in scope:
                return {"message": "Job not in your scope", "status": 403}

        if job.status in ("done", "error"):
            return {"message": f"Job already {job.status}", "jobStatus": job.status, "status": 200}

        job.status = "error"
        job.error = "Cancelled by user"
        job.completed_at = datetime.now(timezone.utc)
        db.session.commit()

        current_app.logger.info(f"[transcribe] job {job_id} cancelled by user {g.user.id}")

        return {"jobId": job_id, "jobStatus": "error", "status": 200}

    @requires_team_admin_or_above
    def status(self):
        """Check transcription job status."""
        from ..database import TranscriptionJob

        job_id = request.args.get("jobId")
        if not job_id:
            return {"message": "jobId required", "status": 400}

        job = TranscriptionJob.query.get(job_id)
        if not job:
            return {"message": "Job not found", "status": 404}
        if job.user_id != g.user.id and not is_org_admin_or_above(g.user):
            scope = team_admin_visible_user_ids(g.user)
            if job.user_id not in scope:
                return {"message": "Job not in your scope", "status": 403}

        return {
            "jobId": job_id,
            "jobStatus": job.status,
            "progress": job.progress or 0,
            "startedAt": job.started_at.isoformat() if job.started_at else None,
            "createdAt": job.created_at.isoformat() if job.created_at else None,
            "error": job.error,
            "status": 200,
        }

    @requires_team_admin_or_above
    def result(self):
        """Get transcription result."""
        from ..database import TranscriptionJob

        job_id = request.args.get("jobId")
        if not job_id:
            return {"message": "jobId required", "status": 400}

        job = TranscriptionJob.query.get(job_id)
        if not job:
            return {"message": "Job not found", "status": 404}
        if job.user_id != g.user.id and not is_org_admin_or_above(g.user):
            scope = team_admin_visible_user_ids(g.user)
            if job.user_id not in scope:
                return {"message": "Job not in your scope", "status": 403}

        if job.status == "error":
            return {
                "jobId": job_id,
                "jobStatus": "error",
                "error": job.error or "Unknown error",
                "status": 500,
            }

        # Parse segments from JSON string
        segments = []
        if job.segments:
            try:
                segments = json.loads(job.segments)
            except (json.JSONDecodeError, TypeError):
                pass

        tags_list = []
        if job.tags:
            try:
                tags_list = json.loads(job.tags)
            except (json.JSONDecodeError, TypeError):
                pass

        return {
            "jobId": job_id,
            "jobStatus": job.status,
            "title": job.title,
            "fileName": job.file_name,
            "tags": tags_list,
            "segments": segments,
            "text": job.text or "",
            "duration": job.duration or 0,
            "progress": job.progress or 0,
            "startedAt": job.started_at.isoformat() if job.started_at else None,
            "createdAt": job.created_at.isoformat() if job.created_at else None,
            "completedAt": job.completed_at.isoformat() if job.completed_at else None,
            "error": job.error,
            "status": 200,
        }

    @requires_team_admin_or_above
    def recent(self):
        """Get recent transcription jobs for the current user."""
        from ..database import TranscriptionJob

        jobs = (
            TranscriptionJob.query
            .filter_by(user_id=g.user.id)
            .order_by(TranscriptionJob.created_at.desc())
            .limit(10)
            .all()
        )

        result = []
        for job in jobs:
            segments = []
            if job.segments:
                try:
                    segments = json.loads(job.segments)
                except (json.JSONDecodeError, TypeError):
                    pass

            tags_list = []
            if job.tags:
                try:
                    tags_list = json.loads(job.tags)
                except (json.JSONDecodeError, TypeError):
                    pass

            result.append({
                "jobId": job.id,
                "jobStatus": job.status,
                "title": job.title,
                "fileName": job.file_name,
                "tags": tags_list,
                "segments": segments,
                "text": job.text or "",
                "duration": job.duration or 0,
                "progress": job.progress or 0,
                "error": job.error,
                "createdAt": job.created_at.isoformat() if job.created_at else None,
                "completedAt": job.completed_at.isoformat() if job.completed_at else None,
            })

        return {"jobs": result, "status": 200}

    @requires_admin
    def cors_status(self):
        """
        Diagnostic: fetch the CURRENT CORS rules on the Spaces bucket and
        report whether our expected rules are in place.
        Useful when uploads fail with 'Missing ETag' and we need to find
        out whether the in-process config actually stuck.
        """
        bucket = current_app.config.get("DO_SPACES_BUCKET")
        if not bucket:
            return {"status": 500, "error": "DO_SPACES_BUCKET not configured"}

        s3 = _get_s3_client()
        try:
            resp = s3.get_bucket_cors(Bucket=bucket)
            rules = resp.get("CORSRules", [])
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "<unknown>")
            if code in ("NoSuchCORSConfiguration", "NoSuchCORSConfigurationError"):
                return {
                    "status": 200,
                    "bucket": bucket,
                    "rules": [],
                    "mikroRulesPresent": [],
                    "mikroRulesExpected": sorted(r["ID"] for r in _MIKRO_CORS_RULES),
                    "bootstrapRanFlag": _CORS_CONFIGURED,
                    "note": "Bucket has NO CORS configuration at all.",
                }
            return {
                "status": 500,
                "error": f"get_bucket_cors failed: code={code} err={str(e)}",
                "bootstrapRanFlag": _CORS_CONFIGURED,
            }

        mikro_ids = {r["ID"] for r in _MIKRO_CORS_RULES}
        present = [r.get("ID") for r in rules if r.get("ID") in mikro_ids]

        return {
            "status": 200,
            "bucket": bucket,
            "ruleCount": len(rules),
            "rules": rules,
            "mikroRulesPresent": sorted(present),
            "mikroRulesExpected": sorted(mikro_ids),
            "bootstrapRanFlag": _CORS_CONFIGURED,
        }

    @requires_admin
    def cors_apply(self):
        """
        Diagnostic: force-run the CORS config (resets the once-per-process
        flag) and return detailed before/after/error info. This is the
        endpoint to hit if a deploy doesn't come up clean.
        """
        global _CORS_CONFIGURED

        bucket = current_app.config.get("DO_SPACES_BUCKET")
        if not bucket:
            return {"status": 500, "error": "DO_SPACES_BUCKET not configured"}

        s3 = _get_s3_client()

        try:
            resp = s3.get_bucket_cors(Bucket=bucket)
            before = resp.get("CORSRules", [])
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "<unknown>")
            if code in ("NoSuchCORSConfiguration", "NoSuchCORSConfigurationError"):
                before = []
            else:
                return {
                    "status": 500,
                    "error": f"get_bucket_cors failed: code={code} err={str(e)}",
                }

        preserved = [
            rule for rule in before
            if not (set(rule.get("AllowedOrigins", [])) & _MIKRO_CORS_ORIGINS)
        ]
        merged = _MIKRO_CORS_RULES + preserved

        try:
            s3.put_bucket_cors(
                Bucket=bucket,
                CORSConfiguration={"CORSRules": merged},
            )
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "<unknown>")
            return {
                "status": 500,
                "error": f"put_bucket_cors failed: code={code} err={str(e)}",
                "beforeRuleCount": len(before),
                "attemptedMikroCount": len(_MIKRO_CORS_RULES),
                "attemptedPreservedCount": len(preserved),
            }

        _CORS_CONFIGURED = True
        return {
            "status": 200,
            "bucket": bucket,
            "beforeRuleCount": len(before),
            "afterRuleCount": len(merged),
            "mikroAdded": len(_MIKRO_CORS_RULES),
            "preservedFromOtherApps": len(preserved),
            "rules": merged,
        }

    # ─────────────────────────────────────────────────────────────────
    # AI actions — send the completed transcript to Claude for a
    # quick analysis (summary, action items, participants, decisions,
    # or a custom prompt). Nothing persists — stateless one-shot.
    # ─────────────────────────────────────────────────────────────────
    @requires_team_admin_or_above
    def ai_action(self):
        from ..database import TranscriptionJob

        body = request.get_json(silent=True) or {}
        job_id = body.get("jobId")
        preset = body.get("preset", "summary")
        custom_prompt = body.get("prompt")

        if not job_id:
            return {"message": "jobId required", "status": 400}

        job = TranscriptionJob.query.get(job_id)
        if not job:
            return {"message": "Job not found", "status": 404}
        if job.user_id != g.user.id and not is_org_admin_or_above(g.user):
            scope = team_admin_visible_user_ids(g.user)
            if job.user_id not in scope:
                return {"message": "Job not in your scope", "status": 403}
        if job.user_id != g.user.id:
            return {"message": "Forbidden", "status": 403}
        if not job.text:
            return {"message": "Transcript not available for this job", "status": 400}

        presets = {
            "summary": (
                "Summarize this meeting transcript concisely. Focus on the main "
                "topics discussed, key points, and overall outcome. Use 2–4 short "
                "paragraphs."
            ),
            "actions": (
                "Extract action items from this transcript as a bulleted list. "
                "For each, include the owner if mentioned, the task itself, and "
                "any deadline that was stated. If no action items are present, "
                "say so explicitly."
            ),
            "participants": (
                "List the distinct participants or speakers mentioned or implied "
                "in this transcript. For each, briefly describe their apparent "
                "role or primary contribution. If only one voice is present, "
                "say so."
            ),
            "decisions": (
                "List the concrete decisions made in this meeting as a bulleted "
                "list. For each, note what was decided and the context or "
                "rationale that was given. If no decisions were made, say so "
                "explicitly."
            ),
        }

        if preset == "custom":
            if not custom_prompt or len(custom_prompt.strip()) < 3:
                return {
                    "message": "A prompt of at least 3 characters is required for custom preset",
                    "status": 400,
                }
            instruction = custom_prompt.strip()
        else:
            instruction = presets.get(preset)
            if not instruction:
                return {"message": f"Unknown preset: {preset}", "status": 400}

        api_key = current_app.config.get("ANTHROPIC_API_KEY")
        if not api_key:
            return {"message": "Anthropic API key not configured", "status": 500}

        try:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            message = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2048,
                system=(
                    "You analyse meeting transcripts for a professional business "
                    "audience. Output in clean markdown. Be concise and direct."
                ),
                messages=[{
                    "role": "user",
                    "content": f"{instruction}\n\n---\nTranscript:\n{job.text}",
                }],
            )
            result_text = message.content[0].text if message.content else ""
            return {
                "result": result_text,
                "preset": preset,
                "model": "claude-haiku-4-5-20251001",
                "tokens": {
                    "input": message.usage.input_tokens,
                    "output": message.usage.output_tokens,
                },
                "status": 200,
            }
        except Exception as e:
            current_app.logger.error(
                f"[transcribe-ai] job={job_id} preset={preset} error={e}"
            )
            return {
                "message": f"AI request failed: {str(e)}",
                "status": 500,
            }

    # ─────────────────────────────────────────────────────────────────
    # Library endpoints — list with search/filter, rename/retag,
    # delete one or many, list distinct tags.
    # All scoped by user_id so users see only their own.
    # ─────────────────────────────────────────────────────────────────
    @requires_team_admin_or_above
    def list_jobs(self):
        """
        Paginated list of the current user's transcription jobs.
        Query params: ?q=<search>&tag=<tag>&limit=20&offset=0&sort=created_at:desc
        Search matches against title (if set) and file_name (case-insensitive).
        """
        from ..database import TranscriptionJob

        q = (request.args.get("q") or "").strip()
        tag = (request.args.get("tag") or "").strip()
        try:
            limit = max(1, min(int(request.args.get("limit", "20")), 100))
            offset = max(0, int(request.args.get("offset", "0")))
        except ValueError:
            limit, offset = 20, 0
        sort = request.args.get("sort", "created_at:desc")

        query = TranscriptionJob.query.filter_by(user_id=g.user.id)

        if q:
            from sqlalchemy import or_, func as sa_func
            like = f"%{q.lower()}%"
            query = query.filter(
                or_(
                    sa_func.lower(TranscriptionJob.title).like(like),
                    sa_func.lower(TranscriptionJob.file_name).like(like),
                )
            )

        if tag:
            # tags stored as JSON array string — a simple substring match is fine
            # for the tag-dropdown filter since tag names are opaque to the user.
            query = query.filter(TranscriptionJob.tags.like(f'%"{tag}"%'))

        sort_map = {
            "created_at:desc": TranscriptionJob.created_at.desc(),
            "created_at:asc": TranscriptionJob.created_at.asc(),
            "duration:desc": TranscriptionJob.duration.desc().nullslast(),
            "duration:asc": TranscriptionJob.duration.asc().nullsfirst(),
            "title:asc": TranscriptionJob.title.asc().nullslast(),
            "title:desc": TranscriptionJob.title.desc().nullslast(),
        }
        query = query.order_by(sort_map.get(sort, TranscriptionJob.created_at.desc()))

        total = query.count()
        jobs = query.offset(offset).limit(limit).all()

        result = []
        for job in jobs:
            tags_list = []
            if job.tags:
                try:
                    tags_list = json.loads(job.tags)
                except (json.JSONDecodeError, TypeError):
                    pass

            result.append({
                "jobId": job.id,
                "jobStatus": job.status,
                "title": job.title,
                "fileName": job.file_name,
                "tags": tags_list,
                "duration": job.duration or 0,
                "progress": job.progress or 0,
                "error": job.error,
                "createdAt": job.created_at.isoformat() if job.created_at else None,
                "completedAt": job.completed_at.isoformat() if job.completed_at else None,
            })

        return {
            "jobs": result,
            "total": total,
            "limit": limit,
            "offset": offset,
            "status": 200,
        }

    @requires_team_admin_or_above
    def list_tags(self):
        """Distinct list of tags this user has used across their jobs."""
        from ..database import TranscriptionJob

        jobs = (
            TranscriptionJob.query
            .filter_by(user_id=g.user.id)
            .filter(TranscriptionJob.tags.isnot(None))
            .all()
        )
        all_tags = set()
        for j in jobs:
            try:
                for t in json.loads(j.tags or "[]"):
                    if isinstance(t, str) and t.strip():
                        all_tags.add(t.strip())
            except (json.JSONDecodeError, TypeError):
                pass

        return {"tags": sorted(all_tags, key=str.lower), "status": 200}

    @requires_team_admin_or_above
    def update_job(self):
        """
        Rename (title) and/or retag (tags) a job.
        Body: { jobId, title?, tags? }  (tags is an array of strings)
        """
        from ..database import db, TranscriptionJob

        body = request.get_json(silent=True) or {}
        job_id = body.get("jobId")
        if not job_id:
            return {"message": "jobId required", "status": 400}

        job = TranscriptionJob.query.get(job_id)
        if not job:
            return {"message": "Job not found", "status": 404}
        if job.user_id != g.user.id and not is_org_admin_or_above(g.user):
            scope = team_admin_visible_user_ids(g.user)
            if job.user_id not in scope:
                return {"message": "Job not in your scope", "status": 403}
        if job.user_id != g.user.id:
            return {"message": "Forbidden", "status": 403}

        if "title" in body:
            new_title = body.get("title")
            if new_title is None:
                job.title = None
            else:
                trimmed = str(new_title).strip()[:500]
                job.title = trimmed or None

        if "tags" in body:
            new_tags = body.get("tags")
            if new_tags is None:
                job.tags = None
            elif isinstance(new_tags, list):
                cleaned = []
                seen = set()
                for t in new_tags:
                    if not isinstance(t, str):
                        continue
                    s = t.strip()[:50]
                    if not s:
                        continue
                    key = s.lower()
                    if key in seen:
                        continue
                    seen.add(key)
                    cleaned.append(s)
                job.tags = json.dumps(cleaned) if cleaned else None
            else:
                return {"message": "tags must be a list of strings", "status": 400}

        db.session.commit()

        tags_list = []
        if job.tags:
            try:
                tags_list = json.loads(job.tags)
            except (json.JSONDecodeError, TypeError):
                pass

        return {
            "jobId": job.id,
            "title": job.title,
            "tags": tags_list,
            "status": 200,
        }

    @requires_team_admin_or_above
    def delete_jobs(self):
        """
        Hard-delete one or more jobs + their Spaces audio (best-effort).
        Body: { jobIds: ["a", "b", ...] }
        """
        from ..database import db, TranscriptionJob

        body = request.get_json(silent=True) or {}
        job_ids = body.get("jobIds") or []
        if not isinstance(job_ids, list) or not job_ids:
            return {"message": "jobIds (non-empty list) required", "status": 400}

        jobs = (
            TranscriptionJob.query
            .filter(TranscriptionJob.id.in_(job_ids))
            .filter_by(user_id=g.user.id)
            .all()
        )
        if not jobs:
            return {"message": "No matching jobs found for this user", "status": 404}

        # Attempt to delete audio files from Spaces first (best-effort).
        bucket = current_app.config.get("DO_SPACES_BUCKET")
        s3 = _get_s3_client() if bucket else None

        spaces_deleted = 0
        spaces_failed = 0
        for job in jobs:
            if s3 and bucket and job.file_url:
                bucket_marker = f"/{bucket}/"
                spaces_key = (
                    job.file_url.split(bucket_marker, 1)[-1]
                    if bucket_marker in job.file_url
                    else None
                )
                if spaces_key:
                    try:
                        s3.delete_object(Bucket=bucket, Key=spaces_key)
                        spaces_deleted += 1
                    except Exception as e:
                        spaces_failed += 1
                        current_app.logger.warning(
                            f"[transcribe-delete] spaces delete failed for "
                            f"job={job.id} key={spaces_key}: {e}"
                        )

        deleted_ids = [j.id for j in jobs]
        for job in jobs:
            db.session.delete(job)
        db.session.commit()

        return {
            "deleted": deleted_ids,
            "spacesDeleted": spaces_deleted,
            "spacesFailed": spaces_failed,
            "status": 200,
        }
