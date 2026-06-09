import pytest
from app import app
from flask import g
from api.database import (
    Project,
    User,
    db,
)
from api.static_variables import (
    TESTING_DB,
    TESTING_ENDPOINT,
    TESTING_PASSWORD,
    TESTING_PORT,
    TESTING_USER,
)

# CONSTANTS FOR IMPORTS
CREATE_PROJECT_ENDPOINT = "/api/project/create_project"
DELETE_PROJECT_ENDPOINT = "/api/project/delete_project"
CALCULATE_BUDGET_ENDPOINT = "/api/project/calculate_budget"
FETCH_USER_PROJECTS_ENDPOINT = "/api/project/fetch_user_projects"
USER_JOIN_PROJECT_ENDPOINT = "/api/project/user_join_project"

# DATA FOR TESTS
data_with_all_required_args = {
    "url": "https://tasks.kaart.com/projects/167",
    "rate_type": True,
    "mapping_rate": float(0.5),
    "validation_rate": float(0.3),
    "visibility": True,
}

# GENERIC ADMIN USER
admin = User(
    deleted_date=None,
    id=28,
    email="devin.markley@kaart.com",
    payment_email="asdf2s@af.com",
    city="asdf",
    country="asdf",
    osm_username="sadf",
    org_id=1,
    first_name="devin",
    last_name="markley",
    create_time="2023-12-18 13:47:33.591857",
    role="admin",
    mapper_points=5,
    validator_points=0,
    special_project_points=0,
    validation_payable_total=0,
    mapping_payable_total=0,
    payable_total=0,
    requested_total=0,
    paid_total=0,
    requesting_payment=False,
)


@pytest.fixture
def client():
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = (
        "postgresql://"
        + TESTING_USER
        + ":"
        + TESTING_PASSWORD
        + "@"
        + TESTING_ENDPOINT
        + ":"
        + TESTING_PORT
        + "/"
        + TESTING_DB
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        clear_database()
        db.create_all()
        db.session.begin_nested()
        add_admin_if_not_exists()
        db.session.commit()

        set_g_user()

        with app.test_request_context():
            with app.test_client() as client:
                yield client

        clear_database()


def add_admin_if_not_exists():
    existing_admin = User.query.filter_by(email="devin.markley@kaart.com").first()
    if not existing_admin:
        db.session.add(admin)
        db.session.commit()


def set_g_user():
    user = User.query.filter_by(role="admin").first()
    g.user = user


def clear_database():
    meta = db.metadata
    # Drop all existing tables
    for table in reversed(meta.sorted_tables):
        if table.name != "users":
            db.session.execute(f"TRUNCATE {table.name} RESTART IDENTITY CASCADE;")

    db.session.commit()


def get_project_id(url):
    # Remove trailing slash and then split
    url_parts = url.rstrip("/").split("/")
    project_id = url_parts[-1]
    return project_id


"""

create_project testing

"""


def test_create_project_with_all_required_args(client):
    """
    This test passes all the required args and should create a project.
    """
    result = client.post(CREATE_PROJECT_ENDPOINT, json=data_with_all_required_args)
    response_json = result.json
    print(response_json)
    status_code = response_json.get("status")
    assert status_code == 200
    """
    This test passes all the required args and should create a project then a redundant project.
    """
    result = client.post(CREATE_PROJECT_ENDPOINT, json=data_with_all_required_args)
    response_json = result.json
    status_code = response_json.get("status")
    assert status_code == 400


def test_create_project_with_missing_args(client):
    """
    This test loops through all the required args removing one
    and then sending a request to check that the function is ensuring
    all the required arguments are present.
    """
    for arg_name in data_with_all_required_args:
        modified_args = data_with_all_required_args.copy()
        del modified_args[arg_name]
        result = client.post(CREATE_PROJECT_ENDPOINT, json=modified_args)
        response_json = result.json
        status_code = response_json.get("status")
        assert status_code == 400


def test_create_project_without_org_id(client):
    """
    This test passes all the required args but not the org_id of the user.
    """
    g.user = None
    result = client.post(CREATE_PROJECT_ENDPOINT, json=data_with_all_required_args)
    response_json = result.json
    status_code = response_json.get("status")
    assert status_code == 304


def test_create_project_without_id_in_url(client):
    """
    This test passes all the required args but not the project_id in the url
    """
    modified_args = data_with_all_required_args.copy()
    modified_args["url"] = "https://tasks.kaart.com/projects/"
    result = client.post(CREATE_PROJECT_ENDPOINT, json=modified_args)
    response_json = result.json
    status_code = response_json.get("status")
    assert status_code == 400


"""

delete_project testing

"""


def test_delete_project_that_doesnt_exist(client):
    """
    Attempts to delte a project that doesn't exist
    """
    project_id = {"project_id": 1000000}
    result = client.post(DELETE_PROJECT_ENDPOINT, json=project_id)

    response_json = result.json
    print(response_json)
    status_code = response_json.get("status")
    assert status_code == 400


def test_delete_project_without_org_id(client):
    """
    This test passes all the required args but not the org_id of the user.
    """
    g.user = None
    project_id = {"project_id": 1000000}
    result = client.post(DELETE_PROJECT_ENDPOINT, json=project_id)

    response_json = result.json
    print(response_json)
    status_code = response_json.get("status")
    assert status_code == 304


def test_delete_project(client):
    """
    Creates a project and then deletes it
    """

    client.post(CREATE_PROJECT_ENDPOINT, json=data_with_all_required_args)
    url_id = get_project_id(data_with_all_required_args["url"])
    project_id = {"project_id": url_id}
    result = client.post(DELETE_PROJECT_ENDPOINT, json=project_id)

    response_json = result.json
    print(response_json)
    status_code = response_json.get("status")
    assert status_code == 200


def test_delete_project_without_project_id(client):
    """
    Attempts to delete a project it without a valid project_id
    """
    project_id = {"project_id": ""}
    result = client.post(DELETE_PROJECT_ENDPOINT, json=project_id)
    response_json = result.json
    print(response_json)
    status_code = response_json.get("status")
    assert status_code == 400


"""

calculate_budget testing

"""


def test_calculate_budget_without_org_id(client):
    """
    This test attempts to calculate the budget with an org_id
    """
    g.user = None
    result = client.post(CALCULATE_BUDGET_ENDPOINT)
    response_json = result.json
    print(response_json)
    status_code = response_json.get("status")
    assert status_code == 304


def test_calculate_budget_with_missing_args(client):
    """
    This test loops through all the required args removing one
    and then sending a request to check that the function is ensuring
    all the required arguments are present.
    """
    calculate_budget_required_args = {
        "url": "https://tasks.kaart.com/projects/167",
        "rate_type": True,
        "mapping_rate": float(0.5),
        "validation_rate": float(0.3),
        "visibility": True,
    }
    for arg_name in calculate_budget_required_args:
        modified_args = calculate_budget_required_args.copy()
        del modified_args[arg_name]
        result = client.post(CALCULATE_BUDGET_ENDPOINT, json=modified_args)
        response_json = result.json
        status_code = response_json.get("status")
        assert status_code == 400


def test_calculate_budget_with_required_args(client):
    # Create the projet to calculate
    client.post(CREATE_PROJECT_ENDPOINT, json=data_with_all_required_args)

    # Get the project id from the general required args
    url_id = get_project_id(data_with_all_required_args["url"])

    # append project_id to the list to mett all the required args
    calculate_budget_args = data_with_all_required_args.copy()
    calculate_budget_args["project_id"] = url_id

    result = client.post(CALCULATE_BUDGET_ENDPOINT, json=calculate_budget_args)
    response_json = result.json
    print(response_json)
    status_code = response_json.get("status")
    assert status_code == 200


def test_calculate_budget_with_nonexistent_project(client):
    # Get the project id from the general required args
    url_id = get_project_id(data_with_all_required_args["url"])

    # append project_id to the list to mett all the required args
    calculate_budget_args = data_with_all_required_args.copy()
    calculate_budget_args["project_id"] = url_id

    result = client.post(CALCULATE_BUDGET_ENDPOINT, json=calculate_budget_args)
    response_json = result.json
    print(response_json)
    status_code = response_json.get("status")
    assert status_code == 400


"""

fetch_user_projects testing

"""


def test_fetch_user_projects_without_org_id(client):
    """
    This test attempts to fetch projects without g.user
    """
    g.user = None
    result = client.post(FETCH_USER_PROJECTS_ENDPOINT)
    response_json = result.json
    print(response_json)
    status_code = response_json.get("status")
    assert status_code == 304


def test_fetch_user_projects(client, benchmark):
    """
    This test that if g.user is present a correct response is given
    """
    response = benchmark(lambda: client.post(FETCH_USER_PROJECTS_ENDPOINT))
    response_json = response.json
    print(response_json)

    status_code = response_json.get("status")
    assert status_code == 200

    expected_keys = [
        "message",
        "user_projects",
        "status",
    ]
    assert all(
        key in response_json for key in expected_keys
    ), f"Missing keys: {set(expected_keys) - set(response_json.keys())}"

    # Check specific values for some keys
    assert isinstance(response_json["user_projects"], list)

    # Check the structure of 'user_projects'
    if response_json["user_projects"]:
        project = response_json["user_projects"][0]
        expected_project_keys = [
            "difficulty",
            "id",
            "mapping_rate_per_task",
            "max_payment",
            "name",
            "payment_due",
            "source",
            "status",
            "total_editors",
            "total_invalidated",
            "total_mapped",
            "total_payout",
            "total_tasks",
            "total_validated",
            "url",
            "validation_rate_per_task",
            "visibility",
        ]
        assert all(
            key in project for key in expected_project_keys
        ), f"Missing keys in project: {set(expected_project_keys) - set(project.keys())}"


# """

# user_join_project testing

# """


# def test_user_join_project_without_org_id(client):
#     """
#     This test attempts to join a project without g.user
#     """
#     g.user = None
#     result = client.post(USER_JOIN_PROJECT_ENDPOINT)
#     response_json = result.json
#     print(response_json)
#     status_code = response_json.get("status")
#     assert status_code == 304


# def test_user_join_project_without_project_id(client):
#     """
#     This test attempts to join a project without a project_id
#     """

#     result = client.post(USER_JOIN_PROJECT_ENDPOINT, json={"project_id": ""})
#     response_json = result.json
#     print(response_json)
#     status_code = response_json.get("status")
#     assert status_code == 400


# def test_user_join_project_without_invalid_project_id(client):
#     """
#     This test attempts to join a project that doesn't exist
#     """

#     result = client.post(USER_JOIN_PROJECT_ENDPOINT, json={"project_id": "10000000"})
#     response_json = result.json
#     print(response_json)
#     status_code = response_json.get("status")
#     assert status_code == 400


# def test_user_join_project(client):
#     """
#     This test attempts to joins a project
#     """
#     # Create a project
#     client.post(CREATE_PROJECT_ENDPOINT, json=data_with_all_required_args)

#     # Get its ID
#     url_id = get_project_id(data_with_all_required_args["url"])

#     # Join it
#     result = client.post(USER_JOIN_PROJECT_ENDPOINT, json={"project_id": url_id})
#     response_json = result.json
#     print(response_json)
#     status_code = response_json.get("status")
#     assert status_code == 200


# def test_user_join_project_the_same_project_twice(client):
#     """
#     This test attempts to joins a project multiple times
#     """
#     # Create a project
#     client.post(CREATE_PROJECT_ENDPOINT, json=data_with_all_required_args)

#     # Get its ID
#     url_id = get_project_id(data_with_all_required_args["url"])

#     # Join it twice
#     client.post(USER_JOIN_PROJECT_ENDPOINT, json={"project_id": url_id})
#     result = client.post(USER_JOIN_PROJECT_ENDPOINT, json={"project_id": url_id})
#     response_json = result.json
#     print(response_json)
#     status_code = response_json.get("status")
#     assert status_code == 400
