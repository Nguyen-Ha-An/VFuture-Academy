# Entra OTP extension API registration contract

Checked against current Microsoft primary documentation and public tenant discovery on 2026-11-02. No tenant mutation was performed for this review.

## Incoming callout issuer

Keep the **single exact CIAM issuer** for this external customer tenant:

```
ENTRA_EXTENSION_TENANT_ID=f3152aa5-61de-40fd-bb76-780b9fbe5428
ENTRA_EXTENSION_ISSUER=https://f3152aa5-61de-40fd-bb76-780b9fbe5428.ciamlogin.com/f3152aa5-61de-40fd-bb76-780b9fbe5428/v2.0
```

The [custom-extension overview](https://learn.microsoft.com/en-us/entra/identity-platform/custom-extension-overview#protect-your-rest-api) explicitly specifies a CIAM issuer for customer callout tokens and `login.microsoftonline.com` for workforce callout tokens. The [OTP-specific cross-tenant Function setup](https://learn.microsoft.com/en-us/entra/identity-platform/custom-extension-email-otp-get-started#51-using-openid-connect-identity-provider) uses CIAM discovery. This is a service-to-service callout contract, not an inference from a user ID token alone.

[Public CIAM discovery for this tenant](https://f3152aa5-61de-40fd-bb76-780b9fbe5428.ciamlogin.com/f3152aa5-61de-40fd-bb76-780b9fbe5428/v2.0/.well-known/openid-configuration) returned that exact issuer and `https://f3152aa5-61de-40fd-bb76-780b9fbe5428.ciamlogin.com/f3152aa5-61de-40fd-bb76-780b9fbe5428/discovery/v2.0/keys`. A separate login.microsoftonline.com discovery document also exists for the tenant; its existence does not prove that OTP callouts use that issuer. Neither `login.microsoftonline.com` nor `sts.windows.net` is accepted by this handler. A real signed OTP callout remains the hosted confirmation; if it contradicts the documented contract, stop and investigate instead of accepting both issuer families.

Validation requires RS256 signature, exact issuer/tenant/API audience, v2 token version, validity claims and `azp=99045fe1-7639-4a75-9d4a-577b6ca3810f`. This is Microsoft's authentication-events caller. The payload must also match the configured extension object and Academy user-facing application. `ENTRA_EXTENSION_AUDIENCE` is the dedicated **API application client UUID**, not its object ID, the Academy frontend client UUID, a Graph UUID, or the full `api://` resource URI. With `requestedAccessTokenVersion=2`, v1 tokens and their `appid` claim are deliberately unsupported. A particular incoming `roles` value is not required by Microsoft's documented callout validation contract; the Graph application permission below is a separate consent check.

## Objects and registration order

All Entra objects below belong to customer tenant `f3152aa5-61de-40fd-bb76-780b9fbe5428`, not the Azure subscription's owner tenant. `API_APP_ID` means application client ID; `API_APP_OBJECT_ID` and `API_SP_OBJECT_ID` are distinct directory object IDs. `GRAPH_SP_OBJECT_ID` is the Microsoft Graph service principal object ID **in this customer tenant**. `ACADEMY_APP_ID` is the existing user-facing Academy app client ID.

1. Create a dedicated single-tenant API application and service principal using `POST /v1.0/applications` with display name `VFuture Academy OTP API` and `signInAudience:"AzureADMyOrg"`, then `POST /v1.0/servicePrincipals` with `{"appId":"API_APP_ID"}`. Do not reuse the Academy frontend app.
2. Patch `/v1.0/applications/API_APP_OBJECT_ID` with the following. `FUNCTION_HOST` is the exact host of the deployed endpoint, with no scheme/path. Preserve any already-required permissions when editing an existing dedicated app.

```json
{
  "identifierUris": ["api://FUNCTION_HOST/API_APP_ID"],
  "api": { "requestedAccessTokenVersion": 2 },
  "requiredResourceAccess": [{
    "resourceAppId": "00000003-0000-0000-c000-000000000000",
    "resourceAccess": [{
      "id": "214e810f-fda8-4fd7-a475-29461495eb00",
      "type": "Role"
    }]
  }]
}
```

3. Grant actual admin consent. Resolve the Graph service principal by `appId=00000003-0000-0000-c000-000000000000` and verify its enabled application role `CustomAuthenticationExtension.Receive.Payload` has ID `214e810f-fda8-4fd7-a475-29461495eb00`. Declare-and-consent are separate operations. The Graph role belongs to the **API service principal**, not to caller `99045...`:

```http
POST https://graph.microsoft.com/v1.0/servicePrincipals/GRAPH_SP_OBJECT_ID/appRoleAssignedTo
Content-Type: application/json
```

```json
{
  "principalId": "API_SP_OBJECT_ID",
  "resourceId": "GRAPH_SP_OBJECT_ID",
  "appRoleId": "214e810f-fda8-4fd7-a475-29461495eb00"
}
```

This follows the [OTP consent instructions](https://learn.microsoft.com/en-us/entra/identity-platform/custom-extension-email-otp-get-started#grant-admin-consent) and [Graph app-role assignment semantics](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-post-approleassignedto?view=graph-rest-1.0). Graph application-role grants require appropriate Graph permissions and a supported privileged administrator role; Application Administrator alone does not grant every Microsoft Graph application permission.

4. Create the extension with `POST /v1.0/identity/customAuthenticationExtensions`:

```json
{
  "@odata.type": "#microsoft.graph.onOtpSendCustomExtension",
  "displayName": "VFuture Academy branded OTP email",
  "authenticationConfiguration": {
    "@odata.type": "#microsoft.graph.azureAdTokenAuthentication",
    "resourceId": "api://FUNCTION_HOST/API_APP_ID"
  },
  "endpointConfiguration": {
    "@odata.type": "#microsoft.graph.httpRequestEndpoint",
    "targetUrl": "https://FUNCTION_HOST/api/entra/email-otp"
  },
  "clientConfiguration": { "timeoutInMilliseconds": 2000, "maximumRetries": 1 }
}
```

Microsoft Graph [v1.0 creation supports onOtpSend](https://learn.microsoft.com/en-us/graph/api/identitycontainer-post-customauthenticationextensions?view=graph-rest-1.0), even though parts of the how-to still show beta. `resourceId` host and targetUrl host must match. Save the returned extension object ID as `ENTRA_EXTENSION_ID`. No function key is appended: this implementation validates the Entra JWT itself. It does not perform browser OIDC redirects, so the API app does not need an additional client secret merely to verify those JWTs; the how-to's client-secret step applies to its Easy Auth OIDC configuration.

5. Before binding a production listener, call `POST /v1.0/identity/customAuthenticationExtensions/EXTENSION_OBJECT_ID/validateAuthenticationConfiguration` with no body. Resolve every error and warning, especially missing payload-permission consent. The [validation API](https://learn.microsoft.com/en-us/graph/api/customauthenticationextension-validateauthenticationconfiguration?view=graph-rest-1.0) checks configuration; it does not establish successful inbox delivery or response latency.
6. Create only the Academy-scoped listener with `POST /v1.0/identity/authenticationEventListeners`:

```json
{
  "@odata.type": "#microsoft.graph.onEmailOtpSendListener",
  "conditions": { "applications": {
    "includeAllApplications": false,
    "includeApplications": [{ "appId": "ACADEMY_APP_ID" }]
  } },
  "handler": {
    "@odata.type": "#microsoft.graph.onOtpSendCustomExtensionHandler",
    "customExtension": { "id": "EXTENSION_OBJECT_ID" }
  }
}
```

The [v1.0 listener creation API](https://learn.microsoft.com/en-us/graph/api/identitycontainer-post-authenticationeventlisteners?view=graph-rest-1.0) supports this type. Extension writes need `CustomAuthenticationExtension.ReadWrite.All`; listener writes need `EventListener.ReadWrite.All`, with a supported administrator role. Do not assign the listener tenant-wide, and do not silently enable Microsoft-provider fallback during a test intended to prove branded email.

## Mandatory hosted gates

The [custom-extension client configuration contract](https://learn.microsoft.com/en-us/graph/api/resources/customextensionclientconfiguration?view=graph-rest-1.0) allows at most2000ms per call and0/1 retry. The handler now uses authenticated encrypted queue acceptance with a1700ms application deadline; ACS retries and Table state run asynchronously. Azure Function cold startup occurs before handler execution and remains a separate hosted risk. **Registration correctness is not OTP delivery readiness.** Measure the entire callback under cold/warm conditions before binding production traffic; use the explicitly modeled always-ready option if the zero-instance cold path cannot meet the deadline. Do not silently add paid always-ready capacity or broaden issuer validation to work around failures.

Verify a real signed callout without logging bearer tokens, codes or recipients: exact configured issuer/audience/tenant/caller, configured extension/client payload, accepted ACS operation, delivered inbox message, and completion within the Entra deadline. This review did not capture an actual callout and did not change cloud state.
