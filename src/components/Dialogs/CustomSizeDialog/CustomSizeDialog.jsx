import React, { useRef, useEffect, useState } from 'react';
import '../Dialog.css';
import './CustomSizeDialog.css';

// Utils
import { cmToPx, inchToPx, pxToCm, pxToInch } from '../../../utils/converters.js';
import { sanitizeNumericInputFromEvent } from '../../../utils/helpers.js';

function SizeInput({ label, inputRef, unitRef, onChange, onUnitChange }) {
  return (
    <div className='custom-image-size-input'>
      <label className='custom-image-size-input-label'>{label}</label>
      <input type='text' className='custom-image-size-input-input' onChange={(e) => { sanitizeNumericInputFromEvent(e); onChange && onChange(); }} ref={inputRef} />
      <select className='custom-image-size-input-unit' ref={unitRef} onChange={onUnitChange}>
        <option value='cm'>cm</option>
        <option value='inch'>inch</option>
        <option value='px'>px</option>
      </select>
    </div>
  )
}

const unitToPx = {
  'inch': inchToPx,
  'cm': cmToPx,
  'px': (val) => val
};

const pxToUnit = {
  'cm': pxToCm,
  'inch': pxToInch,
  'px': (val) => val
};

function CustomSizeDialog({
  referrer,
  selectorRef,
  title,
  sizes,
  setSizes,
  selectedSize,
  setSelectedSize,
  localStorageKey,
  aspectRatio
}) {
  const widthInputRef = useRef(null);
  const widthUnitRef = useRef(null);
  const heightInputRef = useRef(null);
  const heightUnitRef = useRef(null);
  const [lockAspectRatio, setLockAspectRatio] = useState(false);

  useEffect(() => {
    referrer.current.onclose = function () {
      selectorRef.current.value = selectedSize.name;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referrer, selectedSize])

  const syncHeightFromWidth = () => {
    if (!lockAspectRatio || !aspectRatio) return;
    const widthVal = Number.parseFloat(widthInputRef.current.value);
    if (!widthVal || widthVal <= 0) return;
    const widthPx = unitToPx[widthUnitRef.current.value](widthVal);
    const heightPx = widthPx / aspectRatio;
    const heightUnit = heightUnitRef.current.value;
    const result = pxToUnit[heightUnit](heightPx);
    heightInputRef.current.value = parseFloat(result.toFixed(4));
  };

  const syncWidthFromHeight = () => {
    if (!lockAspectRatio || !aspectRatio) return;
    const heightVal = Number.parseFloat(heightInputRef.current.value);
    if (!heightVal || heightVal <= 0) return;
    const heightPx = unitToPx[heightUnitRef.current.value](heightVal);
    const widthPx = heightPx * aspectRatio;
    const widthUnit = widthUnitRef.current.value;
    const result = pxToUnit[widthUnit](widthPx);
    widthInputRef.current.value = parseFloat(result.toFixed(4));
  };

  const addCustomImageSize = () => {
    const width = widthInputRef.current.value;
    const height = heightInputRef.current.value;
    const widthUnit = widthUnitRef.current.value;
    const heightUnit = heightUnitRef.current.value;

    if ((width === '' || height === '') || (Number.parseFloat(width) <= 0 || Number.parseFloat(height) <= 0)) {
      //! For future: replace alert with a toast.
      alert('Enter a valid number: width and height must be greater than 0');
      return;
    }
    else {
      const widthInPx = unitToPx[widthUnit](Number.parseFloat(width));
      const heightInPx = unitToPx[heightUnit](Number.parseFloat(height));
      const customSize = {
        name: `${width}${widthUnit} x ${height}${heightUnit}`,
        width: widthInPx,
        height: heightInPx
      }
      const newSizes = [customSize, ...sizes];
      setSelectedSize(customSize);
      setSizes(newSizes);
      // setSizes([...sizes, customSize]); //? Why is this not working?
      selectorRef.current.value = customSize.name;
      localStorage.setItem(localStorageKey, JSON.stringify(newSizes));
      referrer.current.close();
    }
  }

  const closeDialog = () => {
    referrer.current.close();
    // Set the selector back to the previously selected image size
    //? I think this condition check is not necessary since currrent.value will be 'custom' if we are in this dialog, but I'll keep it for now
    if (`${selectorRef.current.value}`.toLowerCase() === 'custom') selectorRef.current.value = selectedSize.name;
  }

  return (
    <dialog className="dialog custom-image-size-dialog" ref={referrer}>
      <div method='dialog'>
        <div className='dialog-text'>
          <h5 className='dialog-title'>{`${title}`}</h5>
          <form className='custom-image-size-inputs'>
            <SizeInput label='Width' inputRef={widthInputRef} unitRef={widthUnitRef} onChange={syncHeightFromWidth} onUnitChange={syncHeightFromWidth} />
            <SizeInput label='Height' inputRef={heightInputRef} unitRef={heightUnitRef} onChange={syncWidthFromHeight} onUnitChange={syncWidthFromHeight} />
          </form>
          {aspectRatio && (
            <label className='lock-aspect-ratio-checkbox'>
              <input
                type='checkbox'
                checked={lockAspectRatio}
                onChange={(e) => setLockAspectRatio(e.target.checked)}
              />
              <span>Lock aspect ratio</span>
            </label>
          )}
        </div>
        <div className='dialog-buttons'>
          <button className='dialog-button cancel-button' onClick={closeDialog} autoFocus>Cancel</button>
          <button className='dialog-button confirm-button' onClick={addCustomImageSize}>Confirm</button>
        </div>
      </div>
    </dialog>
  )
}

// CustomSizeDialog.propTypes = {
//   referrer: React.PropTypes.object,
//   selectorRef: React.PropTypes.object,
//   title: React.PropTypes.string,
//   sizes: React.PropTypes.array,
//   setSizes: React.PropTypes.func,
//   selectedSize: React.PropTypes.object,
//   setSelectedSize: React.PropTypes.func
// }

export default CustomSizeDialog;