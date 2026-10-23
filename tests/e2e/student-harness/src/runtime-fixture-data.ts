export const COURSE = 'runtime-course';
export const ITEM = 'response-one';
export const BLOCK = 'response-block';
export const START = `/app/courses/${COURSE}/items/${ITEM}`;
export const OUTLINE_DESTINATION = `/app/courses/${COURSE}/items/destination-a`;
export const FIRST_DESTINATION = `${OUTLINE_DESTINATION}?from=first#response`;
export const SECOND_DESTINATION = `/app/courses/${COURSE}/items/destination-b?from=second#response`;
export const RESPONSE = 'My original response must survive a failed write and retry.';
