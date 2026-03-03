import React, { useRef, useState, useEffect } from 'react';
import '../PageSections.css';
import './GenerateImage.css';

// Utils
import { DOWNLOAD_RESULT_IMAGE_NAME, INPUT_IMAGE_BACKGROUND_COLOR, INPUT_IMAGE_BORDER_COLOR, INPUT_IMAGE_BORDER_WIDTH, RESULT_IMAGE_BACKGROUND_COLOR, RESULT_IMAGE_SHEET_SIZES_LOCAL_STORAGE_KEY, COLOR_PROFILES, PRINT_DPI, MIN_OUTPUT_DPI, MAX_OUTPUT_DPI } from '../../../utils/configs.js';
import { INITIAL_SHEET_SIZES } from '../../../utils/initialValues.js';
import { mmToPx } from '../../../utils/converters.js';
import { sanitizeNumericInputFromEvent } from '../../../utils/helpers.js';

// Components
import CustomSizeDialog from '../../Dialogs/CustomSizeDialog/CustomSizeDialog.jsx';
import ConfirmationDialog from '../../Dialogs/ConfirmationDialog/ConfirmationDialog.jsx';

import { useImage } from '../../../contexts/ImageContext.jsx';
import { useChangeManagement } from '../../../contexts/ChangeManagementContext.jsx';

function getCanvasFiltersFromImage(image) {
  // Adjust Canvas filters to visually match CSS filter behavior more accurately.
  // Each filter is tweaked to handle CSS-to-Canvas inconsistencies:
  // - Brightness, contrast, and saturation: Scaled gently to avoid harsh boosts.
  // - Grayscale: Left unchanged as it behaves the same in CSS/Canvas.
  // - Sepia: Divided for a softer, more natural tint.
  // - Hue-rotate: Halved to prevent over-rotation, staying visually consistent with CSS previews.

  return (`
    brightness(${1 + (image.brightness - 100) / 200})
    contrast(${1 + (image.contrast - 100) / 200})
    saturate(${1 + (image.saturate - 100) / 200})
    grayscale(${image.grayscale})
    sepia(${image.sepia / 200})
    hue-rotate(${(image.hueRotate / 2)}deg)
  `);
}

function clampDpi(value) {
  const num = Number(value);
  if (isNaN(num) || num === 0) return MIN_OUTPUT_DPI;
  const clamped = Math.min(MAX_OUTPUT_DPI, Math.max(MIN_OUTPUT_DPI, num));
  return Math.round(clamped);
}

function applyColorProfile(canvas, colorProfile) {
  if (colorProfile === 'rgb') return;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;

  // Process the canvas in vertical stripes to avoid allocating a single,
  // very large ImageData object for high-DPI / large-format canvases.
  const MAX_PIXELS_PER_CHUNK = 10_000_000; // ~40MB of RGBA data
  const stripeHeight = Math.max(1, Math.floor(MAX_PIXELS_PER_CHUNK / width));

  for (let startY = 0; startY < height; startY += stripeHeight) {
    const currentStripeHeight = Math.min(stripeHeight, height - startY);
    const imageData = ctx.getImageData(0, startY, width, currentStripeHeight);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (colorProfile === 'grayscale') {
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      } else if (colorProfile === 'cmyk') {
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        const k = 1 - Math.max(rn, gn, bn);

        if (k === 1) {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        } else {
          const c = (1 - rn - k) / (1 - k);
          const m = (1 - gn - k) / (1 - k);
          const y = (1 - bn - k) / (1 - k);
          data[i] = Math.round(255 * (1 - c) * (1 - k));
          data[i + 1] = Math.round(255 * (1 - m) * (1 - k));
          data[i + 2] = Math.round(255 * (1 - y) * (1 - k));
        }
      }
    }

    ctx.putImageData(imageData, 0, startY);
  }
}

function GenerateImage({ }) {
  const {
    isGenerateDisabled,
    generatingResultFlag
  } = useChangeManagement();
  const {
    image,
    isBordered,
    applyChangesToImage,
    selectedImageSize,
    sheetSizes,
    setSheetSizes,
    selectedSheetSize,
    setSelectedSheetSize,
    gridSettings,
    setGridSettings,
  } = useImage();
  const [resultImage, setResultImage] = useState(null);
  const [isDownloadDisabled, setIsDownloadDisabled] = useState(true);
  const [isResultLoading, setIsResultLoading] = useState(false);
  const customSheetSizeDialogRef = useRef(null);
  const sheetSizeSelectorRef = useRef(null);
  const confirmClearCustomSizesRef = useRef(null);

  useEffect(() => {
    confirmClearCustomSizesRef.current.onclose = function () {
      sheetSizeSelectorRef.current.value = selectedSheetSize.name;
    }
  }, [confirmClearCustomSizesRef, selectedSheetSize]);

  useEffect(() => { // update selector value, incase something else changes selectedSheetSize
    sheetSizeSelectorRef.current.value = selectedSheetSize.name;
  }, [selectedSheetSize]);

  const generateResultImage = async () => {
    if (!image.url) return; // Prevent generating result if no image is uploaded
    if (generatingResultFlag.current) return; // Prevent multiple result generation at the same time

    // Set the flag to prevent multiple result generation at the same time
    // Flag also allows generation of new canvas to apply changes to the input image in applyChangesToImage function.
    // Also set the loading state
    generatingResultFlag.current = true;
    setIsResultLoading(true);

    // Configurations for the result image
    const dpi = clampDpi(gridSettings.dpi);
    const dpiScale = dpi / PRINT_DPI;
    const marginPx = mmToPx(Number(gridSettings.margin) || 0);
    const spacingPx = mmToPx(Number(gridSettings.spacing) || 0);
    const availableWidth = selectedSheetSize.width - (marginPx * 2);
    const availableHeight = selectedSheetSize.height - (marginPx * 2);
    const calculatedColumns = Math.floor((availableWidth + spacingPx) / (selectedImageSize.width + spacingPx));
    const calculatedRows = Math.floor((availableHeight + spacingPx) / (selectedImageSize.height + spacingPx));
    const noOfColumns = calculatedColumns > 0 ? calculatedColumns : 0;
    const noOfRows = calculatedRows > 0 ? calculatedRows : 0;

    if (noOfColumns === 0 || noOfRows === 0) {
      setIsResultLoading(false);
      generatingResultFlag.current = false;
      setIsDownloadDisabled(true);
      alert(
        'With the current sheet size, margins, spacing, and image size, nothing fits on the page. ' +
        'Please adjust these settings and try again.'
      );
      return;
    }

    // Calculate total grid dimensions (scaled for output DPI)
    const scaledImageWidth = Math.round(selectedImageSize.width * dpiScale);
    const scaledImageHeight = Math.round(selectedImageSize.height * dpiScale);
    const scaledSpacingPx = Math.round(spacingPx * dpiScale);
    const totalGridWidth = noOfColumns * scaledImageWidth + (noOfColumns - 1) * scaledSpacingPx;
    const totalGridHeight = noOfRows * scaledImageHeight + (noOfRows - 1) * scaledSpacingPx;
    const scaledSheetWidth = Math.round(selectedSheetSize.width * dpiScale);
    const scaledSheetHeight = Math.round(selectedSheetSize.height * dpiScale);
    const scaledMarginPx = Math.round(marginPx * dpiScale);

    // Calculate starting position based on centering options
    let startX, startY;
    if (gridSettings.centerHorizontally) {
      startX = Math.round((scaledSheetWidth - totalGridWidth) / 2);
    } else {
      startX = scaledMarginPx;
    }
    if (gridSettings.centerVertically) {
      startY = Math.round((scaledSheetHeight - totalGridHeight) / 2);
    } else {
      startY = scaledMarginPx;
    }

    // Canvas for the final sheet image
    const resultImageCanvas = document.createElement('canvas');
    const resultImageCtx = resultImageCanvas.getContext('2d');
    resultImageCanvas.width = scaledSheetWidth;
    resultImageCanvas.height = scaledSheetHeight;
    if (!gridSettings.transparentBackground) {
      resultImageCtx.fillStyle = RESULT_IMAGE_BACKGROUND_COLOR;
      resultImageCtx.fillRect(0, 0, resultImageCanvas.width, resultImageCanvas.height);
    }

    try {
      const url = await applyChangesToImage();

      const inputImage = new Image();
      inputImage.onload = () => {
        // Canvas for the input image (scaled for output DPI)
        const inputImageCanvas = document.createElement('canvas');
        const inputImageCtx = inputImageCanvas.getContext('2d');
        inputImageCanvas.width = scaledImageWidth;
        inputImageCanvas.height = scaledImageHeight;
        if (!gridSettings.transparentBackground) {
          inputImageCtx.fillStyle = INPUT_IMAGE_BACKGROUND_COLOR;
          inputImageCtx.fillRect(0, 0, inputImageCanvas.width, inputImageCanvas.height);
        }
        inputImageCtx.filter = getCanvasFiltersFromImage(image);

        // Adjust and center the image to fit the selected image size
        let newWidth, newHeight, x, y;
        newWidth = scaledImageWidth;
        newHeight = (inputImage.naturalHeight / inputImage.naturalWidth) * scaledImageWidth;
        x = 0;
        y = -((newHeight / 2) - (scaledImageHeight / 2));
        if (newHeight < scaledImageHeight) {
          newWidth = (inputImage.naturalWidth / inputImage.naturalHeight) * scaledImageHeight;
          newHeight = scaledImageHeight;
          x = -((newWidth / 2) - (scaledImageWidth / 2));
          y = 0;
        }
        inputImageCtx.drawImage(inputImage, x, y, newWidth, newHeight);

        if (isBordered) { // Add border to the image
          // Border configurations
          let borderWidth = Math.round(INPUT_IMAGE_BORDER_WIDTH * dpiScale);
          // Adjust border width according to the size of the image (using unscaled dimensions for consistent behavior)
          if ((selectedImageSize.width < 10) || (selectedImageSize.height < 10)) borderWidth = 0;
          else if ((selectedImageSize.width < 30) || (selectedImageSize.height < 30)) borderWidth = 1;

          // Canvas for the bordered input image
          const borderedInputImageCanvas = document.createElement('canvas');
          const borderedInputImageCtx = borderedInputImageCanvas.getContext('2d');
          borderedInputImageCanvas.width = scaledImageWidth;
          borderedInputImageCanvas.height = scaledImageHeight;
          borderedInputImageCtx.fillStyle = INPUT_IMAGE_BORDER_COLOR;
          borderedInputImageCtx.fillRect(0, 0, borderedInputImageCanvas.width, borderedInputImageCanvas.height);

          borderedInputImageCtx.drawImage(
            inputImageCanvas,
            borderWidth,
            borderWidth,
            scaledImageWidth - (borderWidth * 2),
            scaledImageHeight - (borderWidth * 2)
          );

          // Draw the bordered input image on the input image canvas: overlapping the original input image without borders
          inputImageCtx.drawImage(borderedInputImageCanvas, 0, 0, scaledImageWidth, scaledImageHeight);
        }

        // Draw the input image on the result canvas
        for (let i = 0; i < noOfColumns; i++) {
          for (let j = 0; j < noOfRows; j++) {
            resultImageCtx.drawImage(
              inputImageCanvas,
              startX + i * (scaledImageWidth + scaledSpacingPx),
              startY + j * (scaledImageHeight + scaledSpacingPx),
              scaledImageWidth,
              scaledImageHeight
            );
          }
        }

        // Apply color profile transformation
        applyColorProfile(resultImageCanvas, gridSettings.colorProfile);

        // Setting the result image and reset the flags and states
        setResultImage(resultImageCanvas.toDataURL('image/png'));
        generatingResultFlag.current = false;
        setIsDownloadDisabled(false);
        setIsResultLoading(false);
      }
      inputImage.src = url;
    } catch (error) {
      generateResultImage.current = false;
      setIsResultLoading(false);
    }

  }
  const downloadImage = () => {
    if (!resultImage) return;
    const link = document.createElement('a');
    link.href = resultImage;
    link.download = DOWNLOAD_RESULT_IMAGE_NAME;
    link.click();
  }

  const handleSizeChange = (e) => {
    if ((e.target.value !== 'custom') && (e.target.value !== 'clearCustoms')) setSelectedSheetSize(sheetSizes.find(sheetSize => sheetSize.name === e.target.value));
    else if (e.target.value === 'custom') customSheetSizeDialogRef.current.showModal();
    else if (e.target.value === 'clearCustoms') confirmClearCustomSizesRef.current.showModal();
  }

  const clearCustomSizes = () => {
    const initialSizes = [...INITIAL_SHEET_SIZES];
    setSheetSizes(initialSizes);
    setSelectedSheetSize(initialSizes[0]);
    localStorage.removeItem(RESULT_IMAGE_SHEET_SIZES_LOCAL_STORAGE_KEY);
  }

  const handleGridSettingChange = (key, value) => {
    setGridSettings(prev => ({ ...prev, [key]: value }));
  }

  return (
    <section className={`section generate-image-section 
    ${(isGenerateDisabled && !resultImage) ? 'section-disabled' : ''}`}>
      <div className='topbar'>
        <select
          disabled={(isGenerateDisabled && !resultImage)}
          className='topbar-selector'
          onChange={handleSizeChange}
          ref={sheetSizeSelectorRef}
        >
          {
            sheetSizes.map(sheetSize => (
              <option value={`${sheetSize.name}`} key={`${sheetSize.name}`}>{sheetSize.name}</option>
            ))
          }
          <option value='custom'>Custom Size</option>
          {localStorage.getItem(RESULT_IMAGE_SHEET_SIZES_LOCAL_STORAGE_KEY) && <option value='clearCustoms'>Remove/Clear Custom Sizes</option>}
        </select>
        <CustomSizeDialog
          referrer={customSheetSizeDialogRef}
          selectorRef={sheetSizeSelectorRef}
          title='Custom Sheet Size'
          sizes={sheetSizes}
          setSizes={setSheetSizes}
          selectedSize={selectedSheetSize}
          setSelectedSize={setSelectedSheetSize}
          localStorageKey={RESULT_IMAGE_SHEET_SIZES_LOCAL_STORAGE_KEY}
        />
        <ConfirmationDialog
          referrer={confirmClearCustomSizesRef}
          title='Clear custom image sizes?'
          message='This will remove all the saved custom image sizes on this site.'
          onConfirm={clearCustomSizes}
        />
        <button className='primary-button topbar-button' onClick={generateResultImage} disabled={isGenerateDisabled}>Generate</button>
        <button className='primary-button topbar-button' onClick={downloadImage} disabled={isDownloadDisabled}>Download</button>
      </div>
      <div className='grid-settings'>
        <div className='grid-settings-inputs'>
          <label className='grid-setting'>
            <span>Margin</span>
            <input
              type='text'
              className='grid-setting-input'
              value={gridSettings.margin}
              onChange={(e) => {
                sanitizeNumericInputFromEvent(e);
                handleGridSettingChange('margin', e.target.value);
              }}
              onBlur={(e) => {
                const numericValue = Number(e.target.value);
                if (e.target.value === '' || isNaN(numericValue)) {
                  handleGridSettingChange('margin', 0);
                } else {
                  handleGridSettingChange('margin', numericValue);
                }
              }}
            />
            <span className='grid-setting-unit'>mm</span>
          </label>
          <label className='grid-setting'>
            <span>Spacing</span>
            <input
              type='text'
              className='grid-setting-input'
              value={gridSettings.spacing}
              onChange={(e) => {
                sanitizeNumericInputFromEvent(e);
                handleGridSettingChange('spacing', e.target.value);
              }}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value === '' || isNaN(Number(value))) {
                  handleGridSettingChange('spacing', 0);
                } else {
                  handleGridSettingChange('spacing', Number(value));
                }
              }}
            />
            <span className='grid-setting-unit'>mm</span>
          </label>
          <label className='grid-setting'>
            <span>DPI</span>
            <input
              type='text'
              className='grid-setting-input grid-setting-input-dpi'
              value={gridSettings.dpi}
              onChange={(e) => {
                sanitizeNumericInputFromEvent(e);
                handleGridSettingChange('dpi', e.target.value);
              }}
              onBlur={(e) => {
                handleGridSettingChange('dpi', clampDpi(e.target.value));
              }}
            />
          </label>
        </div>
        <div className='grid-settings-checkboxes'>
          <label className='grid-setting-checkbox'>
            <input
              type='checkbox'
              checked={gridSettings.centerHorizontally}
              onChange={(e) => handleGridSettingChange('centerHorizontally', e.target.checked)}
            />
            <span>Center horizontally</span>
          </label>
          <label className='grid-setting-checkbox'>
            <input
              type='checkbox'
              checked={gridSettings.centerVertically}
              onChange={(e) => handleGridSettingChange('centerVertically', e.target.checked)}
            />
            <span>Center vertically</span>
          </label>
          <label className='grid-setting-checkbox'>
            <input
              type='checkbox'
              checked={gridSettings.transparentBackground}
              onChange={(e) => handleGridSettingChange('transparentBackground', e.target.checked)}
            />
            <span>Transparent background</span>
          </label>
        </div>
        <div className='grid-settings-selectors'>
          <label className='grid-setting'>
            <span>Color Profile</span>
            <select
              className='grid-setting-select'
              value={gridSettings.colorProfile}
              onChange={(e) => handleGridSettingChange('colorProfile', e.target.value)}
            >
              {COLOR_PROFILES.map(profile => (
                <option value={profile.value} key={profile.value}>{profile.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className='generate-image-section-main'>
        {resultImage && !isResultLoading ?
          <img className="result-image"
            src={resultImage}
            alt='Result'
          />
          :
          <div>
            {isResultLoading ? 'Generating...' : 'Click \'Generate\' to generate result'}
          </div>
        }
      </div>
    </section>
  )
}

// GenerateImage.propTypes = {
//   image: PropTypes.object.isRequired,
//   isBordered: PropTypes.bool.isRequired,
//   isGenerateDisabled: PropTypes.bool.isRequired,
//   generatingResultFlag: PropTypes.object.isRequired,
//   selectedImageSize: PropTypes.object.isRequired,
//   sheetSizes: PropTypes.array.isRequired,
//   setSheetSizes: PropTypes.func.isRequired,
//   selectedSheetSize: PropTypes.object.isRequired,
//   setSelectedSheetSize: PropTypes.func.isRequired,
//   applyChangesToImage: PropTypes.func.isRequired
// }

export default GenerateImage;