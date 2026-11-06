import { expect, it } from 'vitest';
import { entryCollectionPlan, assertEntryCollectionReadback, workforceClaimsPatch } from '../../scripts/azure-core/configure-entry-flow.mjs';

function flowFixture() {
  return {
    id: '76c08150-f837-47b9-b793-f119e781d283', displayName: 'AcademySignIn',
    conditions: { applications: { includeApplications: [{ appId: '88634bca-540c-4d38-8061-3d8e0f43bfd3' }] } },
    onAttributeCollection: {
      '@odata.type': '#microsoft.graph.onAttributeCollectionExternalUsersSelfServiceSignUp',
      attributes: [{ id: 'email' }, { id: 'displayName' }, { id: 'custom' }],
      attributeCollectionPage: { views: [{ title: 'Details', inputs: [
        { attribute: 'email', hidden: true, required: true },
        { attribute: 'displayName', hidden: true, editable: true, required: false },
        { attribute: 'custom', required: true },
      ] }] },
    },
  };
}

it('deselects Display Name through the documented relationship DELETE and preserves other collection settings', () => {
  const flow = flowFixture();
  const original = structuredClone(flow);
  const plan = entryCollectionPlan(flow);
  expect(plan.removeDisplayName).toBe(true);
  expect(plan.path).toBe('/identity/authenticationEventsFlows/76c08150-f837-47b9-b793-f119e781d283/microsoft.graph.externalUsersSelfServiceSignUpEventsFlow/onAttributeCollection/microsoft.graph.onAttributeCollectionExternalUsersSelfServiceSignUp/attributes/displayName/$ref');
  expect(plan.expectedCollection.attributes).toEqual([{ id: 'email' }, { id: 'custom' }]);
  expect(plan.expectedCollection.attributeCollectionPage.views[0]).toEqual({ title: 'Details', inputs: [
    { attribute: 'email', hidden: true, required: true }, { attribute: 'custom', required: true },
  ] });
  expect(flow).toEqual(original);
  const after = { ...flow, onAttributeCollection: plan.expectedCollection };
  expect(() => assertEntryCollectionReadback(plan, after)).not.toThrow();
  expect(entryCollectionPlan(after).removeDisplayName).toBe(false);
});

it('fails closed on another flow/application, malformed selection or unexpected readback changes', () => {
  const flow = flowFixture();
  const plan = entryCollectionPlan(flow);
  expect(() => entryCollectionPlan({ ...flow, id: 'other' })).toThrow('Unexpected');
  expect(() => entryCollectionPlan({ ...flow, conditions: { applications: { includeApplications: [
    { appId: '88634bca-540c-4d38-8061-3d8e0f43bfd3' }, { appId: 'other' },
  ] } } })).toThrow('Unexpected');
  expect(() => entryCollectionPlan({ ...flow, onAttributeCollection: { ...flow.onAttributeCollection, attributes: [{ id: 'email' }] } })).toThrow('Unexpected');
  expect(() => assertEntryCollectionReadback(plan, flow)).toThrow('readback differs');
  const unexpected = structuredClone(plan.expectedCollection);
  unexpected.attributeCollectionPage.views[0].inputs[0].required = false;
  expect(() => assertEntryCollectionReadback(plan, { ...flow, onAttributeCollection: unexpected })).toThrow('readback differs');
});

it('keeps the last email attribute and is idempotent for an already deselected Display Name', () => {
  const flow = flowFixture();
  flow.onAttributeCollection.attributes = [{ id: 'email' }];
  flow.onAttributeCollection.attributeCollectionPage.views[0].inputs = [{ attribute: 'email', hidden: true, required: true }];
  const plan = entryCollectionPlan(flow);
  expect(plan.removeDisplayName).toBe(false);
  expect(plan.expectedCollection).toEqual(flow.onAttributeCollection);
  expect(() => assertEntryCollectionReadback(plan, flow)).not.toThrow();
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
