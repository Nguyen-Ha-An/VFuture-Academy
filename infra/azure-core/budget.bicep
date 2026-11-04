targetScope = 'subscription'

param academyResourceGroup string
param infrastructureResourceGroup string
param startDate string
param endDate string
var policy = loadJsonContent('functions/src/policy.json')

// Notification only. This does not enable a subscription spending limit.
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'academy-credit-monthly-soft'
  properties: {
    amount: policy.monthlySoftBudgetUsd
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: { startDate: startDate, endDate: endDate }
    filter: { dimensions: { name: 'ResourceGroupName', operator: 'In', values: [academyResourceGroup, infrastructureResourceGroup] } }
    notifications: {
      actual50: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 50, thresholdType: 'Actual', contactEmails: [policy.notifyEmail] }
      actual80: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 80, thresholdType: 'Actual', contactEmails: [policy.notifyEmail] }
      actual100: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, thresholdType: 'Actual', contactEmails: [policy.notifyEmail] }
      forecast100: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, thresholdType: 'Forecasted', contactEmails: [policy.notifyEmail] }
    }
  }
}
