#!/usr/bin/env python3
"""
GeoJSON layer upload, listing, and retrieval for the map viewer.

    GET    /api/layers/list               list layers for current org
    GET    /api/layers/<id>/geojson       return layer as GeoJSON FeatureCollection
    POST   /api/layers/upload?name=<name> upload a GeoJSON FeatureCollection
    DELETE /api/layers/<id>               soft-delete a layer
"""

import json
import re

from flask.views import MethodView
from flask import g, jsonify, request, current_app
from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy import cast, text
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB

from ..database.common import db
from ..database.core import GeoLayer, GeoFeature
from ..utils import requires_auth


class LayersAPI(MethodView):
    decorators = [requires_auth]

    def get(self, path: str):
        if path == "list":
            return self._list()
        # /api/layers/<id>/geojson
        parts = path.split("/")
        if len(parts) == 2 and parts[1] == "geojson":
            return self._geojson(parts[0])
        return jsonify({"message": "Unknown path", "status": 404}), 404

    def post(self, path: str):
        if path == "upload":
            return self._upload()
        return jsonify({"message": "Unknown path", "status": 404}), 404

    def delete(self, path: str):
        return self._delete(path)

    # ── handlers ──────────────────────────────────────────────────────────

    def _list(self):
        layers = (
            GeoLayer.query
            .filter_by(org_id=g.user.org_id)
            .order_by(GeoLayer.create_time.desc())
            .all()
        )
        return jsonify([l.to_dict() for l in layers]), 200

    def _geojson(self, layer_id_str: str):
        try:
            layer_id = int(layer_id_str)
        except ValueError:
            return jsonify({"message": "invalid layer id", "status": 400}), 400

        layer = GeoLayer.query.get(layer_id)
        if not layer or layer.org_id != g.user.org_id:
            return jsonify({"message": "not found", "status": 404}), 404

        rows = (
            db.session.query(
                GeoFeature.properties,
                db.func.ST_AsGeoJSON(GeoFeature.geom).label("geometry"),
            )
            .filter(GeoFeature.layer_id == layer_id)
            .all()
        )

        features = [
            {
                "type": "Feature",
                "properties": r.properties or {},
                "geometry": json.loads(r.geometry),
            }
            for r in rows
        ]
        return jsonify({"type": "FeatureCollection", "features": features}), 200

    def _upload(self):
        name = (request.args.get("name") or "unnamed").strip()
        safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", name or "unnamed")[:64]

        if "file" in request.files:
            f = request.files["file"]
            if not f.filename:
                return jsonify({"message": "no file selected", "status": 400}), 400
            try:
                geojson = json.load(f)
            except (json.JSONDecodeError, UnicodeDecodeError):
                return jsonify({"message": "invalid JSON", "status": 400}), 400
        elif request.is_json:
            geojson = request.get_json(silent=True)
        else:
            return jsonify({"message": "send GeoJSON as file or JSON body", "status": 400}), 400

        if not geojson or geojson.get("type") != "FeatureCollection":
            return jsonify({"message": "root type must be FeatureCollection", "status": 400}), 400

        features_in = geojson.get("features") or []

        try:
            layer = GeoLayer.query.filter_by(
                name=safe_name, org_id=g.user.org_id
            ).first()

            if layer:
                GeoFeature.query.filter_by(layer_id=layer.id).delete()
            else:
                layer = GeoLayer(
                    name=safe_name,
                    org_id=g.user.org_id,
                    created_by=g.user.id,
                )
                db.session.add(layer)
                db.session.flush()

            count = 0
            for feat in features_in:
                geom = feat.get("geometry")
                if not geom:
                    continue
                props = feat.get("properties") or {}
                gf = GeoFeature(
                    layer_id=layer.id,
                    properties=props,
                    geom=db.func.ST_SetSRID(
                        db.func.ST_GeomFromGeoJSON(json.dumps(geom)), 4326
                    ),
                )
                db.session.add(gf)
                count += 1

            layer.feature_count = count
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            current_app.logger.error("Layer upload error: %s", e)
            return jsonify({"message": str(e), "status": 500}), 500

        return jsonify(layer.to_dict()), 201

    def _delete(self, layer_id_str: str):
        try:
            layer_id = int(layer_id_str)
        except ValueError:
            return jsonify({"message": "invalid layer id", "status": 400}), 400

        layer = GeoLayer.query.get(layer_id)
        if not layer or layer.org_id != g.user.org_id:
            return jsonify({"message": "not found", "status": 404}), 404

        layer.delete()
        db.session.commit()
        return jsonify({"message": "deleted", "id": layer_id, "status": 200}), 200
