'use client';

export { CanvasProvider } from './CanvasProvider';
export { CanvasButton, CanvasTextInput, CanvasTextArea, CanvasSelect, CanvasCheckbox, CanvasAlert, CanvasSpinner, CanvasLink } from './controls';
export type { CanvasButtonProps, CanvasTextInputProps, CanvasTextAreaProps, CanvasSelectProps, CanvasSelectOption, CanvasCheckboxProps, CanvasLinkProps } from './controls';

// Native aliases retain InstUI compound members and their full typed contracts.
export { FormFieldGroup as CanvasFormFieldGroup } from '@instructure/ui-form-field/v11_7';
export { Table as CanvasTable } from '@instructure/ui-table/v11_7';
export { CanvasResponsive } from './CanvasResponsive';
export { CanvasDataTable } from './CanvasDataTable';
export type { CanvasDataColumn } from './CanvasDataTable';
export { ProgressBar as CanvasProgressBar, ProgressCircle as CanvasProgressCircle } from '@instructure/ui-progress/v11_7';
export { Tabs as CanvasTabs } from '@instructure/ui-tabs/v11_7';
export { TreeBrowser as CanvasTreeBrowser } from '@instructure/ui-tree-browser/v11_7';
export { DrawerLayout as CanvasDrawerLayout } from '@instructure/ui-drawer-layout/v11_7';
export { NumberInput as CanvasNumberInput } from '@instructure/ui-number-input/v11_7';
export { RadioInput as CanvasRadioInput, RadioInputGroup as CanvasRadioInputGroup } from '@instructure/ui-radio-input/v11_7';
export { Breadcrumb as CanvasBreadcrumb } from '@instructure/ui-breadcrumb/v11_7';
export { Metric as CanvasMetric, MetricGroup as CanvasMetricGroup } from '@instructure/ui-metric/v11_7';
export { CanvasCourseLayout } from './CanvasCourseLayout';
