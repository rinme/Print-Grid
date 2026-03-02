import { PRINT_DPI, CM_PER_INCH, PIXEL_ROUNDING_FACTOR } from './configs.js';

export const cmToPx = (cm) => (((cm * PRINT_DPI) / CM_PER_INCH) * PIXEL_ROUNDING_FACTOR);
export const pxToCm = (px) => ((px / PIXEL_ROUNDING_FACTOR) * CM_PER_INCH / PRINT_DPI);
export const mmToPx = (mm) => cmToPx(mm / 10);
export const inchToCm = (inch) => (inch * CM_PER_INCH);
export const inchToPx = (inch) => (cmToPx(inchToCm(inch)));
export const pxToInch = (px) => (pxToCm(px) / CM_PER_INCH);