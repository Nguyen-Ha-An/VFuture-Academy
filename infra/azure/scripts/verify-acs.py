#!/usr/bin/env python3
"""Read-only ACS readiness check using the operator's Azure CLI session. No keys or DNS writes."""
import json
import re
import subprocess
import sys


def verify(config, reader):
    prefix = f"/subscriptions/{config['subscriptionId']}/resourceGroups/rg-vfuture-academy-sg/providers/Microsoft.Communication/"
    if config.get('resourceGroup') != 'rg-vfuture-academy-sg' or config['acsResourceId'] != prefix + 'communicationServices/academy-sg-acs' or config['acsSmtpUsernameResourceId'] != prefix + 'communicationServices/academy-sg-acs/smtpUsernames/academy-runtime':
        raise ValueError('ACS scope mismatch')
    domain_id = config['acsEmailDomainResourceId']
    if not domain_id.startswith(prefix + 'emailServices/academy-sg-email/domains/'):
        raise ValueError('ACS domain scope mismatch')
    if not re.fullmatch(r'[a-z0-9.-]+', domain_id.split('/')[-1]):
        raise ValueError('Invalid domain')
    communication, domain, smtp = (reader(config[key]) for key in ('acsResourceId', 'acsEmailDomainResourceId', 'acsSmtpUsernameResourceId'))
    if domain_id.lower() not in [x.lower() for x in communication.get('properties', {}).get('linkedDomains', [])]:
        raise ValueError('Verified email domain is not linked to ACS')
    states = domain.get('properties', {}).get('verificationStates', {})
    if any(states.get(name, {}).get('status') != 'Verified' for name in ['Domain', 'SPF', 'DKIM', 'DKIM2']):
        raise ValueError('Domain, SPF and DKIM verification must be complete')
    props = smtp.get('properties', {})
    if not props.get('entraApplicationId') or not props.get('tenantId') or not props.get('username'):
        raise ValueError('Entra SMTP identity is incomplete')
    return {'acsResourceId': communication['id'], 'emailDomainResourceId': domain['id'], 'smtpIdentityConfigured': True}


if __name__ == '__main__':
    try:
        config = json.load(open(sys.argv[1]))
        def read(resource_id):
            output = subprocess.run(['az', 'resource', 'show', '--ids', resource_id, '--api-version', '2025-09-01', '--output', 'json', '--only-show-errors'], capture_output=True, check=True, text=True, timeout=30)
            return json.loads(output.stdout)
        verify(config, read)
        print('Existing Academy ACS domain/link/SMTP identity verified. SMTP secret validity and delivery still require a test send.')
    except Exception:
        raise SystemExit('ACS readiness failed. Do not provision or cut over until the exact Academy resources are verified.')
