"""Run Django against the confirmed local development DB using ignored .env."""
import os
import runpy
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
values = dict(
    line.split('=', 1)
    for line in (root / '.env').read_text().splitlines()
    if line.strip() and not line.lstrip().startswith('#') and '=' in line
)
if values.get('DB_ENGINE') != 'postgresql' or values.get('DB_HOST') != '127.0.0.1' or values.get('DB_NAME') != 'smarttrade_dev':
    raise SystemExit('Local launcher requires PostgreSQL smarttrade_dev on 127.0.0.1.')
for key, value in values.items():
    if key.startswith(('DJANGO_', 'DB_', 'SMARTTRADE_')) and key != 'SMARTTRADE_SETUP_PASSWORD_B64':
        os.environ[key] = value
if len(sys.argv) > 1 and sys.argv[1] == 'test':
    os.environ['DB_USER'] = values['DB_TEST_USER']
    os.environ['DB_PASSWORD'] = values['DB_TEST_PASSWORD']
    # Development auth tests opt in explicitly; a local preview's flags must
    # not change the production-boundary defaults of the regression suite.
    os.environ['SMARTTRADE_ENABLE_DEV_AUTH'] = 'false'
    os.environ['SMARTTRADE_ENABLE_DEV_OTP'] = 'false'
    os.environ['SMARTTRADE_ENABLE_DEV_EMAIL'] = 'false'
    os.environ['SMARTTRADE_DEV_AUTH_STAFF_ID'] = ''
api_root = root / 'services' / 'api'
os.chdir(api_root)
sys.path.insert(0, str(api_root))
runpy.run_path(str(api_root / 'manage.py'), run_name='__main__')
