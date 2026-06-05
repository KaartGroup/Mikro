"""WSGI entrypoint for the comms service.

Works under either invocation:
  - `gunicorn comms.wsgi:application`  (repo root / package parent on sys.path)
  - `gunicorn wsgi:application`        (App Platform sets cwd INSIDE comms/ via
                                        source_dir=comms, so this module loads
                                        top-level with no package parent)

In the second case the `comms` package's parent dir isn't on sys.path, so a
plain relative import fails. We try the package import first and, if that
fails, add the parent directory and retry — keeping the package structure
intact rather than flattening it.
"""

import os
import sys

try:
    from comms import create_app
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from comms import create_app

application = create_app()
app = application  # convenience alias for `flask run`

if __name__ == "__main__":
    application.run(port=5005, debug=True)
