import { expect, it } from 'vitest';
import { entryCollectionPatch, workforceClaimsPatch } from '../../scripts/azure-core/configure-entry-flow.mjs';

it('hides only the existing name field without changing email, other attributes or the input', () => {
  const flow = { id: '76c08150-f837-47b9-b793-f119e781d283', displayName: 'AcademySignIn', conditions: { applications: { includeApplications: [{ appId: '88634bca-540c-4d38-8061-3d8e0f43bfd3' }] } }, onAttributeCollection: { attributeCollectionPage: { views: [{ inputs: [{ attribute: 'email', hidden: true }, { attribute: 'displayName', hidden: false }, { attribute: 'custom', required: true }] }] } } };
  const result = entryCollectionPatch(flow);
  expect(result.onAttributeCollection.attributeCollectionPage.views[0].inputs).toEqual([{ attribute: 'email', hidden: true }, { attribute: 'displayName', hidden: true, editable: true, required: false, writeToDirectory: true }, { attribute: 'custom', required: true }]);
  expect(flow.onAttributeCollection.attributeCollectionPage.views[0].inputs[1].hidden).toBe(false);
  expect(() => entryCollectionPatch({ ...flow, id: 'other' })).toThrow('Unexpected');
});

it('preserves existing claims and refuses guest claim overrides or a multitenant workforce app', () => {
  const app = { signInAudience: 'AzureADMyOrg', optionalClaims: { accessToken: [{ name: 'other' }], idToken: [{ name: 'auth_time' }] } };
  const patch = workforceClaimsPatch(app);
  expect(patch.optionalClaims.idToken.map((claim: { name: string }) => claim.name)).toEqual(['auth_time', 'upn', 'acct']);
  expect(patch.optionalClaims.accessToken).toEqual(app.optionalClaims.accessToken);
  expect(workforceClaimsPatch({ ...app, ...patch })).toEqual(patch);
  expect(() => workforceClaimsPatch({ signInAudience: 'AzureADMultipleOrgs' })).toThrow('single tenant');
  expect(() => workforceClaimsPatch({ ...app, optionalClaims: { idToken: [{ name: 'upn', additionalProperties: ['include_externally_authenticated_upn'] }] } })).toThrow('override');
});
