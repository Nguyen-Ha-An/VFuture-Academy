#!/usr/bin/env python3
"""Offline operator helper. Settings + SMTP credentials on stdin; secrets only to a new 0600 file."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sys
import time
from urllib.parse import urlsplit


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode()


def create_env(settings):
    required = {'SUPABASE_PUBLIC_URL', 'ACADEMY_SITE_URL', 'AUTH_REDIRECT_URLS', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_ADMIN_EMAIL'}
    optional = {'GOTRUE_EXTERNAL_GOOGLE_ENABLED', 'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID', 'GOTRUE_EXTERNAL_GOOGLE_SECRET'}
    if not required.issubset(settings) or set(settings) - required - optional:
        raise ValueError('Provide exactly the documented runtime settings and SMTP credentials')
    for name, value in settings.items():
        if not isinstance(value, str) or not value or any(c in value for c in '\r\n\0'):
            raise ValueError(f'Invalid single-line value: {name}')
    for name in ('SUPABASE_PUBLIC_URL', 'ACADEMY_SITE_URL'):
        parsed = urlsplit(settings[name])
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError(f'{name} must be an HTTPS origin without trailing slash')
    if settings.get('GOTRUE_EXTERNAL_GOOGLE_ENABLED', 'false') not in ('true', 'false'):
        raise ValueError('Google OAuth enabled must be true or false')
    if settings.get('GOTRUE_EXTERNAL_GOOGLE_ENABLED') == 'true' and not {'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID', 'GOTRUE_EXTERNAL_GOOGLE_SECRET'}.issubset(settings):
        raise ValueError('Enabled Google OAuth requires client ID and secret')
    values = dict(settings)
    values.update({name: secrets.token_hex(32) for name in ('POSTGRES_PASSWORD', 'JWT_SECRET', 'SUPABASE_GATEWAY_KEY', 'GATEWAY_TRANSFER_GRANT_KEY', 'PG_META_CRYPTO_KEY')})
    now = int(time.time())
    for role, name in [('anon', 'ANON_KEY'), ('service_role', 'SERVICE_ROLE_KEY')]:
        header = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
        payload = b64(json.dumps({'role': role, 'iss': 'supabase', 'iat': now, 'exp': now + 365 * 86400}, separators=(',', ':')).encode())
        signature = b64(hmac.new(values['JWT_SECRET'].encode(), f'{header}.{payload}'.encode(), hashlib.sha256).digest())
        values[name] = f'{header}.{payload}.{signature}'
    def quote(value):
        return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"
    return ''.join(f'{key}={quote(value)}\n' for key, value in values.items())


def main():
    if len(sys.argv) != 2:
        raise ValueError('Usage: create-runtime-secrets.py /absolute/protected/path/runtime.env < settings.json')
    target = Path(sys.argv[1])
    repo = Path(__file__).resolve().parents[3]
    if not target.is_absolute() or target.resolve().is_relative_to(repo):
        raise ValueError('Secret output must be absolute and outside the repository')
    content = create_env(json.load(sys.stdin))
    # O_EXCL prevents accidental production credential replacement.
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(content)
    print('Created protected runtime secret file. Values were not printed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
