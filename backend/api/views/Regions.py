#!/usr/bin/env python3
"""
Region & Country API endpoints for Mikro.

Handles geographic region/country CRUD, user-country assignments,
and filter options for the universal FilterBar.
"""

from flask.views import MethodView
from flask import g, request

from ..utils import requires_team_admin_or_above, requires_admin
from ..auth import UserScope
from ..database import (
    db,
    Region,
    Country,
    UserCountry,
    Project,
    ProjectCountry,
    TrainingCountry,
    User,
    Team,
)


class RegionAPI(MethodView):
    """Region/Country management and filter options API."""

    def post(self, path: str):
        # Region CRUD
        if path == "fetch_regions":
            return self.fetch_regions()
        elif path == "create_region":
            return self.create_region()
        elif path == "update_region":
            return self.update_region()
        elif path == "delete_region":
            return self.delete_region()
        # Country CRUD
        elif path == "fetch_countries":
            return self.fetch_countries()
        elif path == "create_country":
            return self.create_country()
        elif path == "update_country":
            return self.update_country()
        elif path == "delete_country":
            return self.delete_country()
        # User-country assignments
        elif path == "assign_user_country":
            return self.assign_user_country()
        elif path == "unassign_user_country":
            return self.unassign_user_country()
        # Filter options
        elif path == "fetch_filter_options":
            return self.fetch_filter_options()
        # Location assignments
        elif path == "assign_project_locations":
            return self.assign_project_locations()
        elif path == "unassign_project_location":
            return self.unassign_project_location()
        elif path == "fetch_project_locations":
            return self.fetch_project_locations()
        elif path == "assign_training_locations":
            return self.assign_training_locations()
        elif path == "unassign_training_location":
            return self.unassign_training_location()
        elif path == "fetch_training_locations":
            return self.fetch_training_locations()
        elif path == "seed_defaults":
            return self.seed_defaults()
        # Public (non-admin) endpoints
        elif path == "list_countries":
            return self.list_countries()
        return {"message": "Unknown path", "status": 404}

    # ─── Regions ──────────────────────────────────────────

    @requires_team_admin_or_above
    def fetch_regions(self):
        """List all regions with their countries."""
        regions = Region.query.order_by(Region.name).all()

        # Pre-fetch all countries, grouped by region_id
        all_countries = Country.query.order_by(Country.name).all()
        countries_by_region = {}
        for c in all_countries:
            countries_by_region.setdefault(c.region_id, []).append(c)

        # Pre-fetch user counts per country in one query
        user_count_rows = (
            db.session.query(UserCountry.country_id, db.func.count(UserCountry.id))
            .group_by(UserCountry.country_id)
            .all()
        )
        user_count_map = {row[0]: row[1] for row in user_count_rows}

        result = []
        for r in regions:
            countries = countries_by_region.get(r.id, [])
            result.append(
                {
                    "id": r.id,
                    "name": r.name,
                    "org_id": r.org_id,
                    "countries": [
                        {
                            "id": c.id,
                            "name": c.name,
                            "iso_code": c.iso_code,
                            "default_timezone": c.default_timezone,
                            "user_count": user_count_map.get(c.id, 0),
                        }
                        for c in countries
                    ],
                }
            )
        return {"status": 200, "regions": result}

    @requires_admin
    def create_region(self):
        """Create a new region."""
        name = (request.json.get("name") or "").strip()
        if not name:
            return {"message": "Region name is required", "status": 400}

        existing = Region.query.filter_by(name=name).first()
        if existing:
            return {"message": f"Region '{name}' already exists", "status": 400}

        region = Region.create(name=name, org_id=g.user.org_id)
        return {
            "status": 200,
            "message": f"Region '{name}' created",
            "region": {"id": region.id, "name": region.name},
        }

    @requires_admin
    def update_region(self):
        """Update a region's name."""
        region_id = request.json.get("regionId")
        name = (request.json.get("name") or "").strip()
        if not region_id or not name:
            return {"message": "regionId and name are required", "status": 400}

        region = Region.query.get(region_id)
        if not region:
            return {"message": "Region not found", "status": 404}

        region.update(name=name)
        return {"status": 200, "message": f"Region updated to '{name}'"}

    @requires_admin
    def delete_region(self):
        """Delete a region. Countries in this region will have region_id set to NULL."""
        region_id = request.json.get("regionId")
        if not region_id:
            return {"message": "regionId is required", "status": 400}

        region = Region.query.get(region_id)
        if not region:
            return {"message": "Region not found", "status": 404}

        # Unlink countries from this region
        Country.query.filter_by(region_id=region_id).update({"region_id": None})
        region.delete(soft=False)
        return {"status": 200, "message": "Region deleted"}

    # ─── Countries ────────────────────────────────────────

    @requires_team_admin_or_above
    def fetch_countries(self):
        """List all countries with region info."""
        countries = Country.query.order_by(Country.name).all()

        # Pre-fetch all regions into a lookup dict
        all_regions = Region.query.all()
        region_map = {r.id: r for r in all_regions}

        # Pre-fetch user counts per country in one query
        user_count_rows = (
            db.session.query(UserCountry.country_id, db.func.count(UserCountry.id))
            .group_by(UserCountry.country_id)
            .all()
        )
        user_count_map = {row[0]: row[1] for row in user_count_rows}

        result = []
        for c in countries:
            region = region_map.get(c.region_id) if c.region_id else None
            result.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "iso_code": c.iso_code,
                    "region_id": c.region_id,
                    "region_name": region.name if region else None,
                    "default_timezone": c.default_timezone,
                    "user_count": user_count_map.get(c.id, 0),
                }
            )
        return {"status": 200, "countries": result}

    @requires_admin
    def create_country(self):
        """Create a new country."""
        name = (request.json.get("name") or "").strip()
        iso_code = (request.json.get("isoCode") or "").strip().upper() or None
        region_id = request.json.get("regionId")
        default_timezone = (request.json.get("defaultTimezone") or "").strip() or None

        if not name:
            return {"message": "Country name is required", "status": 400}

        if iso_code:
            existing = Country.query.filter_by(iso_code=iso_code).first()
            if existing:
                return {
                    "message": f"Country with ISO code '{iso_code}' already exists",
                    "status": 400,
                }

        country = Country.create(
            name=name,
            iso_code=iso_code,
            region_id=region_id,
            default_timezone=default_timezone,
            org_id=g.user.org_id,
        )
        return {
            "status": 200,
            "message": f"Country '{name}' created",
            "country": {"id": country.id, "name": country.name},
        }

    @requires_admin
    def update_country(self):
        """Update country details."""
        country_id = request.json.get("countryId")
        if not country_id:
            return {"message": "countryId is required", "status": 400}

        country = Country.query.get(country_id)
        if not country:
            return {"message": "Country not found", "status": 404}

        updates = {}
        if "name" in request.json:
            updates["name"] = request.json["name"].strip()
        if "isoCode" in request.json:
            updates["iso_code"] = (
                request.json["isoCode"] or ""
            ).strip().upper() or None
        if "regionId" in request.json:
            updates["region_id"] = request.json["regionId"]
        if "defaultTimezone" in request.json:
            updates["default_timezone"] = (
                request.json["defaultTimezone"] or ""
            ).strip() or None

        if updates:
            country.update(**updates)
        return {"status": 200, "message": "Country updated"}

    @requires_admin
    def delete_country(self):
        """Delete a country and its user-country associations."""
        country_id = request.json.get("countryId")
        if not country_id:
            return {"message": "countryId is required", "status": 400}

        country = Country.query.get(country_id)
        if not country:
            return {"message": "Country not found", "status": 404}

        # Remove user-country associations (CASCADE should handle this, but be explicit)
        UserCountry.query.filter_by(country_id=country_id).delete()
        # Clear country_id on users who have this as their primary
        User.query.filter_by(country_id=country_id).update({"country_id": None})
        country.delete(soft=False)
        return {"status": 200, "message": "Country deleted"}

    # ─── User-Country Assignments ─────────────────────────

    @requires_admin
    def assign_user_country(self):
        """Assign a user to a country."""
        user_id = request.json.get("userId")
        country_id = request.json.get("countryId")
        is_primary = request.json.get("isPrimary", True)

        if not user_id or not country_id:
            return {"message": "userId and countryId are required", "status": 400}

        # Check if already assigned
        existing = UserCountry.query.filter_by(
            user_id=user_id, country_id=country_id
        ).first()
        if existing:
            return {"message": "User already assigned to this country", "status": 400}

        UserCountry.create(
            user_id=user_id, country_id=country_id, is_primary=is_primary
        )

        # Also set the user's country_id if this is primary
        if is_primary:
            user = UserScope(g.user).get(user_id)
            if user:
                country = Country.query.get(country_id)
                updates = {"country_id": country_id}
                # Auto-set timezone from country default if user has none
                if country and country.default_timezone and not user.timezone:
                    updates["timezone"] = country.default_timezone
                user.update(**updates)

        return {"status": 200, "message": "User assigned to country"}

    @requires_admin
    def unassign_user_country(self):
        """Remove a user from a country."""
        user_id = request.json.get("userId")
        country_id = request.json.get("countryId")

        if not user_id or not country_id:
            return {"message": "userId and countryId are required", "status": 400}

        record = UserCountry.query.filter_by(
            user_id=user_id, country_id=country_id
        ).first()
        if not record:
            return {"message": "Assignment not found", "status": 404}

        record.delete(soft=False)

        # If this was the user's primary country, clear it
        user = UserScope(g.user).get(user_id)
        if user and user.country_id == country_id:
            user.update(country_id=None)

        return {"status": 200, "message": "User unassigned from country"}

    # ─── Filter Options ───────────────────────────────────

    @requires_team_admin_or_above
    def fetch_filter_options(self):
        """
        Return all available filter dimensions and their values.
        Used by the frontend FilterBar to populate dropdowns.
        """
        org_id = g.user.org_id

        # Countries — only those linked to at least one project in this org
        project_country_ids = (
            db.session.query(ProjectCountry.country_id)
            .join(Project, Project.id == ProjectCountry.project_id)
            .filter(Project.org_id == org_id)
            .distinct()
            .subquery()
        )
        countries = (
            Country.query.filter(Country.id.in_(project_country_ids))
            .order_by(Country.name)
            .all()
        )
        country_options = [
            {
                "id": c.id,
                "name": c.name,
                "region_id": c.region_id,
            }
            for c in countries
        ]

        # Regions — only those that contain at least one of the above countries
        represented_region_ids = {c.region_id for c in countries if c.region_id}
        regions = (
            Region.query.filter(Region.id.in_(represented_region_ids))
            .order_by(Region.name)
            .all()
        )
        region_options = [{"id": r.id, "name": r.name} for r in regions]

        # Teams
        teams = Team.query.order_by(Team.name).all()
        team_options = [{"id": t.id, "name": t.name} for t in teams]

        # Roles — distinct roles from users in this org
        role_rows = (
            db.session.query(User.role)
            .filter(User.org_id == org_id, User.role != None)
            .distinct()
            .all()
        )
        role_options = sorted([r.role for r in role_rows])

        # Timezones — distinct timezones from users in this org
        tz_rows = (
            db.session.query(User.timezone)
            .filter(User.org_id == org_id, User.timezone != None)
            .distinct()
            .all()
        )
        timezone_options = sorted([r.timezone for r in tz_rows])

        return {
            "status": 200,
            "dimensions": {
                "country": country_options,
                "region": region_options,
                "team": team_options,
                "role": role_options,
                "timezone": timezone_options,
            },
        }

    # ─── Location Assignments (Projects / Trainings / Checklists) ───

    def _expand_regions_to_countries(self, region_ids):
        """Expand a list of region IDs to the set of their country IDs."""
        if not region_ids:
            return set()
        rows = (
            Country.query.filter(Country.region_id.in_(region_ids))
            .with_entities(Country.id)
            .all()
        )
        return {r.id for r in rows}

    def _assign_locations(self, model_class, fk_name, resource_id):
        """Generic assign: create rows idempotently for country + region expansion."""
        country_ids = set(request.json.get("countryIds") or [])
        region_ids = request.json.get("regionIds") or []
        country_ids |= self._expand_regions_to_countries(region_ids)

        if not country_ids:
            return {"message": "No countries or regions provided", "status": 400}

        existing = {
            getattr(r, "country_id")
            for r in model_class.query.filter(
                getattr(model_class, fk_name) == resource_id
            ).all()
        }
        created = 0
        for cid in country_ids:
            if cid not in existing:
                model_class.create(**{fk_name: resource_id, "country_id": cid})
                created += 1

        return {
            "status": 200,
            "message": f"{created} location(s) assigned",
            "created": created,
            "skipped": len(country_ids) - created,
        }

    def _unassign_location(self, model_class, fk_name, resource_id):
        """Remove a single country assignment."""
        country_id = request.json.get("countryId")
        if not country_id:
            return {"message": "countryId is required", "status": 400}

        record = model_class.query.filter(
            getattr(model_class, fk_name) == resource_id,
            model_class.country_id == country_id,
        ).first()
        if not record:
            return {"message": "Assignment not found", "status": 404}

        record.delete(soft=False)
        return {"status": 200, "message": "Location unassigned"}

    def _fetch_locations(self, model_class, fk_name, resource_id):
        """Return assigned countries + all available countries/regions."""
        assigned_rows = model_class.query.filter(
            getattr(model_class, fk_name) == resource_id
        ).all()
        assigned_country_ids = {r.country_id for r in assigned_rows}

        # Pre-fetch all countries and regions into lookup dicts
        all_countries_list = Country.query.order_by(Country.name).all()
        country_map = {c.id: c for c in all_countries_list}
        all_regions_list = Region.query.order_by(Region.name).all()
        region_map = {r.id: r for r in all_regions_list}

        assigned_countries = []
        for cid in assigned_country_ids:
            country = country_map.get(cid)
            if country:
                region = (
                    region_map.get(country.region_id) if country.region_id else None
                )
                assigned_countries.append(
                    {
                        "id": country.id,
                        "name": country.name,
                        "iso_code": country.iso_code,
                        "region_name": region.name if region else None,
                    }
                )

        assigned_countries.sort(key=lambda c: c["name"])

        # All available countries & regions for the UI dropdowns
        all_countries = [
            {
                "id": c.id,
                "name": c.name,
                "iso_code": c.iso_code,
                "region_id": c.region_id,
            }
            for c in all_countries_list
        ]
        all_regions = [{"id": r.id, "name": r.name} for r in all_regions_list]

        return {
            "status": 200,
            "assigned_countries": assigned_countries,
            "all_countries": all_countries,
            "all_regions": all_regions,
        }

    # ── Project locations ──

    @requires_team_admin_or_above
    def assign_project_locations(self):
        resource_id = request.json.get("resourceId")
        if not resource_id:
            return {"message": "resourceId is required", "status": 400}
        return self._assign_locations(ProjectCountry, "project_id", resource_id)

    @requires_team_admin_or_above
    def unassign_project_location(self):
        resource_id = request.json.get("resourceId")
        if not resource_id:
            return {"message": "resourceId is required", "status": 400}
        return self._unassign_location(ProjectCountry, "project_id", resource_id)

    @requires_team_admin_or_above
    def fetch_project_locations(self):
        resource_id = request.json.get("resourceId")
        if not resource_id:
            return {"message": "resourceId is required", "status": 400}
        return self._fetch_locations(ProjectCountry, "project_id", resource_id)

    # ── Training locations ──

    @requires_team_admin_or_above
    def assign_training_locations(self):
        resource_id = request.json.get("resourceId")
        if not resource_id:
            return {"message": "resourceId is required", "status": 400}
        return self._assign_locations(TrainingCountry, "training_id", resource_id)

    @requires_team_admin_or_above
    def unassign_training_location(self):
        resource_id = request.json.get("resourceId")
        if not resource_id:
            return {"message": "resourceId is required", "status": 400}
        return self._unassign_location(TrainingCountry, "training_id", resource_id)

    @requires_team_admin_or_above
    def fetch_training_locations(self):
        resource_id = request.json.get("resourceId")
        if not resource_id:
            return {"message": "resourceId is required", "status": 400}
        return self._fetch_locations(TrainingCountry, "training_id", resource_id)

    # ─── Public Endpoints (no admin required) ──────────────

    def list_countries(self):
        """List all countries grouped by region. Available to all authenticated users."""
        countries = Country.query.order_by(Country.name).all()

        # Pre-fetch all regions into a lookup dict
        all_regions = Region.query.all()
        region_map = {r.id: r for r in all_regions}

        result = []
        for c in countries:
            region = region_map.get(c.region_id) if c.region_id else None
            result.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "iso_code": c.iso_code,
                    "region_id": c.region_id,
                    "region_name": region.name if region else None,
                    "default_timezone": c.default_timezone,
                }
            )
        return {"status": 200, "countries": result}

    # ─── Seed Defaults ────────────────────────────────────

    @requires_team_admin_or_above
    def seed_defaults(self):
        """Seed default regions and countries. Idempotent — skips existing."""
        import logging

        logger = logging.getLogger(__name__)

        defaults = {
            # ─── Americas ────────────────────────────────────
            "North America": [
                ("United States", "USA", "America/New_York"),
                ("Canada", "CAN", "America/Toronto"),
            ],
            "Central America": [
                ("Mexico", "MEX", "America/Mexico_City"),
                ("Guatemala", "GTM", "America/Guatemala"),
                ("Belize", "BLZ", "America/Belize"),
                ("Honduras", "HND", "America/Tegucigalpa"),
                ("El Salvador", "SLV", "America/El_Salvador"),
                ("Nicaragua", "NIC", "America/Managua"),
                ("Costa Rica", "CRI", "America/Costa_Rica"),
                ("Panama", "PAN", "America/Panama"),
            ],
            "Caribbean": [
                ("Cuba", "CUB", "America/Havana"),
                ("Jamaica", "JAM", "America/Jamaica"),
                ("Haiti", "HTI", "America/Port-au-Prince"),
                ("Dominican Republic", "DOM", "America/Santo_Domingo"),
                ("Trinidad and Tobago", "TTO", "America/Port_of_Spain"),
                ("Barbados", "BRB", "America/Barbados"),
                ("Bahamas", "BHS", "America/Nassau"),
                ("Grenada", "GRD", "America/Grenada"),
                ("Saint Lucia", "LCA", "America/St_Lucia"),
                ("Dominica", "DMA", "America/Dominica"),
                ("Saint Vincent and the Grenadines", "VCT", "America/St_Vincent"),
                ("Antigua and Barbuda", "ATG", "America/Antigua"),
                ("Saint Kitts and Nevis", "KNA", "America/St_Kitts"),
                ("Puerto Rico", "PRI", "America/Puerto_Rico"),
            ],
            "South America": [
                ("Colombia", "COL", "America/Bogota"),
                ("Peru", "PER", "America/Lima"),
                ("Brazil", "BRA", "America/Sao_Paulo"),
                ("Chile", "CHL", "America/Santiago"),
                ("Argentina", "ARG", "America/Argentina/Buenos_Aires"),
                ("Ecuador", "ECU", "America/Guayaquil"),
                ("Bolivia", "BOL", "America/La_Paz"),
                ("Paraguay", "PRY", "America/Asuncion"),
                ("Uruguay", "URY", "America/Montevideo"),
                ("Venezuela", "VEN", "America/Caracas"),
                ("Guyana", "GUY", "America/Guyana"),
                ("Suriname", "SUR", "America/Paramaribo"),
            ],
            # ─── Europe ──────────────────────────────────────
            "Europe": [
                ("United Kingdom", "GBR", "Europe/London"),
                ("France", "FRA", "Europe/Paris"),
                ("Germany", "DEU", "Europe/Berlin"),
                ("Netherlands", "NLD", "Europe/Amsterdam"),
                ("Belgium", "BEL", "Europe/Brussels"),
                ("Luxembourg", "LUX", "Europe/Luxembourg"),
                ("Ireland", "IRL", "Europe/Dublin"),
                ("Switzerland", "CHE", "Europe/Zurich"),
                ("Austria", "AUT", "Europe/Vienna"),
                ("Liechtenstein", "LIE", "Europe/Vaduz"),
                ("Monaco", "MCO", "Europe/Monaco"),
                ("Sweden", "SWE", "Europe/Stockholm"),
                ("Norway", "NOR", "Europe/Oslo"),
                ("Denmark", "DNK", "Europe/Copenhagen"),
                ("Finland", "FIN", "Europe/Helsinki"),
                ("Iceland", "ISL", "Atlantic/Reykjavik"),
                ("Estonia", "EST", "Europe/Tallinn"),
                ("Latvia", "LVA", "Europe/Riga"),
                ("Lithuania", "LTU", "Europe/Vilnius"),
                ("Spain", "ESP", "Europe/Madrid"),
                ("Portugal", "PRT", "Europe/Lisbon"),
                ("Italy", "ITA", "Europe/Rome"),
                ("Greece", "GRC", "Europe/Athens"),
                ("Croatia", "HRV", "Europe/Zagreb"),
                ("Slovenia", "SVN", "Europe/Ljubljana"),
                ("Malta", "MLT", "Europe/Malta"),
                ("Cyprus", "CYP", "Asia/Nicosia"),
                ("Albania", "ALB", "Europe/Tirane"),
                ("Montenegro", "MNE", "Europe/Podgorica"),
                ("North Macedonia", "MKD", "Europe/Skopje"),
                ("Bosnia and Herzegovina", "BIH", "Europe/Sarajevo"),
                ("Serbia", "SRB", "Europe/Belgrade"),
                ("Andorra", "AND", "Europe/Andorra"),
                ("San Marino", "SMR", "Europe/San_Marino"),
                ("Vatican City", "VAT", "Europe/Vatican"),
                ("Poland", "POL", "Europe/Warsaw"),
                ("Czech Republic", "CZE", "Europe/Prague"),
                ("Slovakia", "SVK", "Europe/Bratislava"),
                ("Hungary", "HUN", "Europe/Budapest"),
                ("Romania", "ROU", "Europe/Bucharest"),
                ("Bulgaria", "BGR", "Europe/Sofia"),
                ("Ukraine", "UKR", "Europe/Kiev"),
                ("Moldova", "MDA", "Europe/Chisinau"),
                ("Belarus", "BLR", "Europe/Minsk"),
                ("Russia", "RUS", "Europe/Moscow"),
                ("Georgia", "GEO", "Asia/Tbilisi"),
                ("Armenia", "ARM", "Asia/Yerevan"),
                ("Azerbaijan", "AZE", "Asia/Baku"),
                ("Turkey", "TUR", "Europe/Istanbul"),
            ],
            # ─── Africa ──────────────────────────────────────
            "Africa": [
                ("Egypt", "EGY", "Africa/Cairo"),
                ("Libya", "LBY", "Africa/Tripoli"),
                ("Tunisia", "TUN", "Africa/Tunis"),
                ("Algeria", "DZA", "Africa/Algiers"),
                ("Morocco", "MAR", "Africa/Casablanca"),
                ("Sudan", "SDN", "Africa/Khartoum"),
                ("South Sudan", "SSD", "Africa/Juba"),
                ("Kenya", "KEN", "Africa/Nairobi"),
                ("Tanzania", "TZA", "Africa/Dar_es_Salaam"),
                ("Uganda", "UGA", "Africa/Kampala"),
                ("Rwanda", "RWA", "Africa/Kigali"),
                ("Ethiopia", "ETH", "Africa/Addis_Ababa"),
                ("Mozambique", "MOZ", "Africa/Maputo"),
                ("Madagascar", "MDG", "Indian/Antananarivo"),
                ("Burundi", "BDI", "Africa/Bujumbura"),
                ("Eritrea", "ERI", "Africa/Asmara"),
                ("Djibouti", "DJI", "Africa/Djibouti"),
                ("Somalia", "SOM", "Africa/Mogadishu"),
                ("Comoros", "COM", "Indian/Comoro"),
                ("Mauritius", "MUS", "Indian/Mauritius"),
                ("Seychelles", "SYC", "Indian/Mahe"),
                ("Malawi", "MWI", "Africa/Blantyre"),
                ("Nigeria", "NGA", "Africa/Lagos"),
                ("Ghana", "GHA", "Africa/Accra"),
                ("Senegal", "SEN", "Africa/Dakar"),
                ("Mali", "MLI", "Africa/Bamako"),
                ("Cameroon", "CMR", "Africa/Douala"),
                ("Ivory Coast", "CIV", "Africa/Abidjan"),
                ("Guinea", "GIN", "Africa/Conakry"),
                ("Burkina Faso", "BFA", "Africa/Ouagadougou"),
                ("Niger", "NER", "Africa/Niamey"),
                ("Benin", "BEN", "Africa/Porto-Novo"),
                ("Togo", "TGO", "Africa/Lome"),
                ("Sierra Leone", "SLE", "Africa/Freetown"),
                ("Liberia", "LBR", "Africa/Monrovia"),
                ("Mauritania", "MRT", "Africa/Nouakchott"),
                ("Gambia", "GMB", "Africa/Banjul"),
                ("Guinea-Bissau", "GNB", "Africa/Bissau"),
                ("Cape Verde", "CPV", "Atlantic/Cape_Verde"),
                ("Chad", "TCD", "Africa/Ndjamena"),
                ("Central African Republic", "CAF", "Africa/Bangui"),
                ("Republic of the Congo", "COG", "Africa/Brazzaville"),
                ("Democratic Republic of the Congo", "COD", "Africa/Kinshasa"),
                ("Equatorial Guinea", "GNQ", "Africa/Malabo"),
                ("Gabon", "GAB", "Africa/Libreville"),
                ("Sao Tome and Principe", "STP", "Africa/Sao_Tome"),
                ("South Africa", "ZAF", "Africa/Johannesburg"),
                ("Botswana", "BWA", "Africa/Gaborone"),
                ("Zimbabwe", "ZWE", "Africa/Harare"),
                ("Zambia", "ZMB", "Africa/Lusaka"),
                ("Namibia", "NAM", "Africa/Windhoek"),
                ("Angola", "AGO", "Africa/Luanda"),
                ("Lesotho", "LSO", "Africa/Maseru"),
                ("Eswatini", "SWZ", "Africa/Mbabane"),
            ],
            # ─── Middle East ─────────────────────────────────
            "Middle East": [
                ("Saudi Arabia", "SAU", "Asia/Riyadh"),
                ("United Arab Emirates", "ARE", "Asia/Dubai"),
                ("Qatar", "QAT", "Asia/Qatar"),
                ("Kuwait", "KWT", "Asia/Kuwait"),
                ("Bahrain", "BHR", "Asia/Bahrain"),
                ("Oman", "OMN", "Asia/Muscat"),
                ("Yemen", "YEM", "Asia/Aden"),
                ("Iraq", "IRQ", "Asia/Baghdad"),
                ("Iran", "IRN", "Asia/Tehran"),
                ("Jordan", "JOR", "Asia/Amman"),
                ("Lebanon", "LBN", "Asia/Beirut"),
                ("Syria", "SYR", "Asia/Damascus"),
                ("Israel", "ISR", "Asia/Jerusalem"),
                ("Palestine", "PSE", "Asia/Gaza"),
            ],
            # ─── Asia ────────────────────────────────────────
            "Asia": [
                ("China", "CHN", "Asia/Shanghai"),
                ("Japan", "JPN", "Asia/Tokyo"),
                ("South Korea", "KOR", "Asia/Seoul"),
                ("North Korea", "PRK", "Asia/Pyongyang"),
                ("Mongolia", "MNG", "Asia/Ulaanbaatar"),
                ("Taiwan", "TWN", "Asia/Taipei"),
                ("Hong Kong", "HKG", "Asia/Hong_Kong"),
                ("India", "IND", "Asia/Kolkata"),
                ("Bangladesh", "BGD", "Asia/Dhaka"),
                ("Nepal", "NPL", "Asia/Kathmandu"),
                ("Sri Lanka", "LKA", "Asia/Colombo"),
                ("Pakistan", "PAK", "Asia/Karachi"),
                ("Afghanistan", "AFG", "Asia/Kabul"),
                ("Bhutan", "BTN", "Asia/Thimphu"),
                ("Maldives", "MDV", "Indian/Maldives"),
                ("Uzbekistan", "UZB", "Asia/Tashkent"),
                ("Kazakhstan", "KAZ", "Asia/Almaty"),
                ("Kyrgyzstan", "KGZ", "Asia/Bishkek"),
                ("Tajikistan", "TJK", "Asia/Dushanbe"),
                ("Turkmenistan", "TKM", "Asia/Ashgabat"),
            ],
            "SE Asia": [
                ("Philippines", "PHL", "Asia/Manila"),
                ("Indonesia", "IDN", "Asia/Jakarta"),
                ("Vietnam", "VNM", "Asia/Ho_Chi_Minh"),
                ("Cambodia", "KHM", "Asia/Phnom_Penh"),
                ("Thailand", "THA", "Asia/Bangkok"),
                ("Myanmar", "MMR", "Asia/Yangon"),
                ("Malaysia", "MYS", "Asia/Kuala_Lumpur"),
                ("Singapore", "SGP", "Asia/Singapore"),
                ("Laos", "LAO", "Asia/Vientiane"),
                ("Brunei", "BRN", "Asia/Brunei"),
                ("Timor-Leste", "TLS", "Asia/Dili"),
            ],
            # ─── Oceania ─────────────────────────────────────
            "Oceania": [
                ("Australia", "AUS", "Australia/Sydney"),
                ("New Zealand", "NZL", "Pacific/Auckland"),
                ("Papua New Guinea", "PNG", "Pacific/Port_Moresby"),
                ("Fiji", "FJI", "Pacific/Fiji"),
                ("Solomon Islands", "SLB", "Pacific/Guadalcanal"),
                ("Vanuatu", "VUT", "Pacific/Efate"),
                ("Samoa", "WSM", "Pacific/Apia"),
                ("Tonga", "TON", "Pacific/Tongatapu"),
                ("Micronesia", "FSM", "Pacific/Pohnpei"),
                ("Palau", "PLW", "Pacific/Palau"),
                ("Marshall Islands", "MHL", "Pacific/Majuro"),
                ("Kiribati", "KIR", "Pacific/Tarawa"),
                ("Nauru", "NRU", "Pacific/Nauru"),
                ("Tuvalu", "TUV", "Pacific/Funafuti"),
            ],
        }

        created_regions = 0
        created_countries = 0
        skipped_countries = 0
        errors = []

        for region_name, country_list in defaults.items():
            region = Region.query.filter_by(name=region_name).first()
            if not region:
                region = Region(name=region_name, org_id=g.user.org_id)
                db.session.add(region)
                db.session.flush()  # get region.id without committing
                created_regions += 1

            for country_name, iso_code, tz in country_list:
                existing = Country.query.filter_by(iso_code=iso_code).first()
                if existing:
                    # Update region_id if country exists but isn't linked
                    if existing.region_id != region.id:
                        existing.region_id = region.id
                    skipped_countries += 1
                    continue
                try:
                    country = Country(
                        name=country_name,
                        iso_code=iso_code,
                        region_id=region.id,
                        default_timezone=tz,
                        org_id=g.user.org_id,
                    )
                    db.session.add(country)
                    db.session.flush()
                    created_countries += 1
                except Exception as e:
                    db.session.rollback()
                    logger.error(f"Failed to create country {country_name}: {e}")
                    errors.append(f"{country_name}: {str(e)}")

        # Single commit for everything
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to commit seed data: {e}")
            return {
                "status": 500,
                "message": f"Failed to commit: {str(e)}",
            }

        msg = f"Seeded {created_regions} regions and {created_countries} countries"
        if skipped_countries:
            msg += f" ({skipped_countries} already existed)"
        if errors:
            msg += f". Errors: {'; '.join(errors)}"

        return {
            "status": 200,
            "message": msg,
            "created_regions": created_regions,
            "created_countries": created_countries,
        }
