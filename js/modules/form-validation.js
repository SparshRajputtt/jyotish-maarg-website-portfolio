/**
 * form-validation.js
 * Jyotish Maarg - Form Validation Module
 *
 * @module form-validation
 */

const FORM_SELECTOR = 'form';
const ERROR_CLASS = 'is-error';
const ERROR_MESSAGE_CLASS = 'form-error-msg';
const ERROR_ID_SUFFIX = 'error';

const NAME_SELECTOR = [
  '[data-validate="name"]',
  'input[name="name"]',
  'input[name="fullName"]',
  'input[name="full_name"]',
].join(', ');

const PHONE_SELECTOR = [
  '[data-validate="phone"]',
  'input[type="tel"]',
  'input[name="phone"]',
  'input[name="mobile"]',
  'input[name="mobileNumber"]',
  'input[name="mobile_number"]',
].join(', ');

const EMAIL_SELECTOR = [
  '[data-validate="email"]',
  'input[type="email"]',
  'input[name="email"]',
].join(', ');

const SERVICE_SELECTOR = [
  'select[data-validate="service"]',
  'select[name="service"]',
  'select[name="serviceRequired"]',
  'select[name="service_required"]',
].join(', ');

const CONTACT_METHOD_SELECTOR = [
  'input[type="radio"][data-validate="preferred-contact"]',
  'input[type="radio"][name="preferredContactMethod"]',
  'input[type="radio"][name="preferred_contact_method"]',
  'input[type="radio"][name="contactMethod"]',
  'input[type="radio"][name="contact_method"]',
].join(', ');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INDIAN_MOBILE_PATTERN = /^(?:\+91|91)?[6-9]\d{9}$/;

/** @type {WeakMap<HTMLFormElement, { onSubmit: EventListener, cleanup: Array<() => void> }>} */
const formInstances = new WeakMap();

/** @type {WeakMap<HTMLElement, string|null>} */
const originalDescriptions = new WeakMap();

/**
 * @param {string|null|undefined} value
 * @returns {string}
 */
function cleanText(value) {
  return String(value ?? '').trim();
}

/**
 * @param {HTMLInputElement} field
 * @returns {string}
 */
function cleanPhone(field) {
  return cleanText(field.value).replace(/[\s()-]/g, '');
}

/**
 * @param {HTMLElement} field
 * @returns {string}
 */
function getFieldId(field) {
  if (field.id) return field.id;

  const name = field.getAttribute('name') || field.dataset.validate || 'field';
  field.id = `form-${name.replace(/[^\w-]/g, '-').toLowerCase()}`;
  return field.id;
}

/**
 * @param {HTMLElement} field
 * @returns {HTMLElement}
 */
function getErrorAnchor(field) {
  if (field instanceof HTMLInputElement && field.type === 'radio') {
    return field.closest('.radio-group, fieldset, .form-group') || field;
  }

  return field;
}

/**
 * @param {HTMLElement} field
 * @returns {HTMLElement}
 */
function getErrorContainer(field) {
  return field.closest('.form-group, fieldset') || field.parentElement || field;
}

/**
 * @param {HTMLElement} field
 * @returns {HTMLElement}
 */
function getDescribedElement(field) {
  if (!(field instanceof HTMLInputElement) || field.type !== 'radio') {
    return field;
  }

  const group = field.closest('[role="radiogroup"], fieldset, .radio-group');
  return group instanceof HTMLElement ? group : field;
}

/**
 * @param {HTMLElement} field
 * @returns {HTMLElement}
 */
function getErrorElement(field) {
  const anchor = getErrorAnchor(field);
  const errorId = `${getFieldId(field)}-${ERROR_ID_SUFFIX}`;
  const existing = document.getElementById(errorId);

  if (existing instanceof HTMLElement) return existing;

  const error = document.createElement('p');
  error.id = errorId;
  error.className = ERROR_MESSAGE_CLASS;
  error.setAttribute('role', 'alert');

  anchor.insertAdjacentElement('afterend', error);
  return error;
}

/**
 * @param {HTMLElement} describedElement
 * @param {string} errorId
 */
function addDescription(describedElement, errorId) {
  if (!originalDescriptions.has(describedElement)) {
    originalDescriptions.set(describedElement, describedElement.getAttribute('aria-describedby'));
  }

  const ids = new Set(
    cleanText(describedElement.getAttribute('aria-describedby'))
      .split(/\s+/)
      .filter(Boolean)
  );

  ids.add(errorId);
  describedElement.setAttribute('aria-describedby', Array.from(ids).join(' '));
}

/**
 * @param {HTMLElement} describedElement
 * @param {string} errorId
 */
function removeDescription(describedElement, errorId) {
  const ids = cleanText(describedElement.getAttribute('aria-describedby'))
    .split(/\s+/)
    .filter((id) => id && id !== errorId);

  if (ids.length === 0) {
    describedElement.removeAttribute('aria-describedby');
    return;
  }

  describedElement.setAttribute('aria-describedby', ids.join(' '));
}

/**
 * @param {HTMLElement} field
 * @param {string} message
 */
function setError(field, message) {
  const error = getErrorElement(field);
  const describedElement = getDescribedElement(field);

  field.classList.add(ERROR_CLASS);
  field.setAttribute('aria-invalid', 'true');
  error.textContent = message;
  addDescription(describedElement, error.id);
}

/**
 * @param {HTMLElement} field
 */
function clearError(field) {
  const errorId = `${getFieldId(field)}-${ERROR_ID_SUFFIX}`;
  const error = document.getElementById(errorId);
  const describedElement = getDescribedElement(field);

  field.classList.remove(ERROR_CLASS);
  field.setAttribute('aria-invalid', 'false');

  if (error) {
    error.remove();
  }

  removeDescription(describedElement, errorId);
}

/**
 * @param {HTMLInputElement} field
 * @returns {boolean}
 */
function validateName(field) {
  const value = cleanText(field.value);
  field.value = value;

  if (!value) {
    setError(field, 'Please enter your name.');
    return false;
  }

  if (value.length < 2) {
    setError(field, 'Name must be at least 2 characters.');
    return false;
  }

  clearError(field);
  return true;
}

/**
 * @param {HTMLInputElement} field
 * @returns {boolean}
 */
function validatePhone(field) {
  const value = cleanPhone(field);

  if (!value) {
    setError(field, 'Please enter your mobile number.');
    return false;
  }

  if (!INDIAN_MOBILE_PATTERN.test(value)) {
    setError(field, 'Please enter a valid Indian mobile number.');
    return false;
  }

  clearError(field);
  return true;
}

/**
 * @param {HTMLInputElement} field
 * @returns {boolean}
 */
function validateEmail(field) {
  const value = cleanText(field.value);
  field.value = value;

  if (!value) {
    clearError(field);
    return true;
  }

  if (!EMAIL_PATTERN.test(value)) {
    setError(field, 'Please enter a valid email address.');
    return false;
  }

  clearError(field);
  return true;
}

/**
 * @param {HTMLSelectElement} field
 * @returns {boolean}
 */
function validateService(field) {
  if (!cleanText(field.value)) {
    setError(field, 'Please select a service.');
    return false;
  }

  clearError(field);
  return true;
}

/**
 * @param {HTMLInputElement[]} radios
 * @returns {boolean}
 */
function validateContactMethod(radios) {
  if (radios.length === 0) return true;

  const checked = radios.some((radio) => radio.checked);
  const firstRadio = radios[0];

  if (!checked) {
    setError(firstRadio, 'Please choose a preferred contact method.');
    radios.forEach((radio) => radio.setAttribute('aria-invalid', 'true'));
    return false;
  }

  clearError(firstRadio);
  radios.forEach((radio) => radio.setAttribute('aria-invalid', 'false'));
  return true;
}

/**
 * @param {HTMLFormElement} form
 * @returns {{
 *   name: HTMLInputElement|null,
 *   phone: HTMLInputElement|null,
 *   email: HTMLInputElement|null,
 *   service: HTMLSelectElement|null,
 *   contactMethods: HTMLInputElement[]
 * }}
 */
function getFields(form) {
  const name = form.querySelector(NAME_SELECTOR);
  const phone = form.querySelector(PHONE_SELECTOR);
  const email = form.querySelector(EMAIL_SELECTOR);
  const service = form.querySelector(SERVICE_SELECTOR);
  const contactMethods = Array.from(form.querySelectorAll(CONTACT_METHOD_SELECTOR))
    .filter((field) => field instanceof HTMLInputElement);

  return {
    name: name instanceof HTMLInputElement ? name : null,
    phone: phone instanceof HTMLInputElement ? phone : null,
    email: email instanceof HTMLInputElement ? email : null,
    service: service instanceof HTMLSelectElement ? service : null,
    contactMethods,
  };
}

/**
 * @param {HTMLFormElement} form
 * @returns {boolean}
 */
function shouldValidateForm(form) {
  const fields = getFields(form);
  return Boolean(fields.name || fields.phone || fields.email || fields.service || fields.contactMethods.length);
}

/**
 * @param {HTMLFormElement} form
 * @returns {{ valid: boolean, firstInvalid: HTMLElement|null }}
 */
function validateForm(form) {
  const fields = getFields(form);
  const results = [];

  if (fields.name) results.push({ field: fields.name, valid: validateName(fields.name) });
  if (fields.phone) results.push({ field: fields.phone, valid: validatePhone(fields.phone) });
  if (fields.email) results.push({ field: fields.email, valid: validateEmail(fields.email) });
  if (fields.service) results.push({ field: fields.service, valid: validateService(fields.service) });

  if (fields.contactMethods.length) {
    results.push({
      field: fields.contactMethods[0],
      valid: validateContactMethod(fields.contactMethods),
    });
  }

  const firstInvalid = results.find((result) => !result.valid)?.field || null;

  return {
    valid: firstInvalid === null,
    firstInvalid,
  };
}

/**
 * @param {HTMLFormElement} form
 * @returns {Array<() => void>}
 */
function bindFieldValidation(form) {
  const fields = getFields(form);
  const cleanup = [];

  /**
   * @param {HTMLElement} field
   * @param {keyof HTMLElementEventMap} type
   * @param {EventListener} listener
   */
  function addFieldListener(field, type, listener) {
    field.addEventListener(type, listener);
    cleanup.push(() => field.removeEventListener(type, listener));
  }

  if (fields.name) {
    const onBlur = () => validateName(fields.name);
    const onInput = () => {
      if (fields.name?.getAttribute('aria-invalid') === 'true') validateName(fields.name);
    };

    addFieldListener(fields.name, 'blur', onBlur);
    addFieldListener(fields.name, 'input', onInput);
  }

  if (fields.phone) {
    const onBlur = () => validatePhone(fields.phone);
    const onInput = () => {
      if (fields.phone?.getAttribute('aria-invalid') === 'true') validatePhone(fields.phone);
    };

    addFieldListener(fields.phone, 'blur', onBlur);
    addFieldListener(fields.phone, 'input', onInput);
  }

  if (fields.email) {
    const onBlur = () => validateEmail(fields.email);
    const onInput = () => {
      if (fields.email?.getAttribute('aria-invalid') === 'true') validateEmail(fields.email);
    };

    addFieldListener(fields.email, 'blur', onBlur);
    addFieldListener(fields.email, 'input', onInput);
  }

  if (fields.service) {
    const onBlur = () => validateService(fields.service);
    const onChange = () => validateService(fields.service);

    addFieldListener(fields.service, 'blur', onBlur);
    addFieldListener(fields.service, 'change', onChange);
  }

  fields.contactMethods.forEach((radio) => {
    const onChange = () => validateContactMethod(fields.contactMethods);
    addFieldListener(radio, 'change', onChange);
  });

  return cleanup;
}

/**
 * @param {HTMLFormElement} form
 */
function initForm(form) {
  if (formInstances.has(form) || !shouldValidateForm(form)) return;

  const onSubmit = (event) => {
    const result = validateForm(form);

    if (result.valid) return;

    event.preventDefault();
    result.firstInvalid?.focus({ preventScroll: false });
  };

  const cleanup = bindFieldValidation(form);
  form.addEventListener('submit', onSubmit);
  formInstances.set(form, { onSubmit, cleanup });
}

/**
 * Initialises validation for matching forms.
 *
 * @param {Document|HTMLElement} [root=document]
 * @returns {{ destroy: () => void }}
 */
function initFormValidation(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return { destroy };
  }

  root.querySelectorAll(FORM_SELECTOR).forEach((form) => {
    if (form instanceof HTMLFormElement) {
      initForm(form);
    }
  });

  return { destroy };
}

/**
 * Removes submit listeners and clears tracked module state.
 */
function destroy() {
  document.querySelectorAll(FORM_SELECTOR).forEach((form) => {
    if (!(form instanceof HTMLFormElement)) return;

    const instance = formInstances.get(form);
    if (!instance) return;

    form.removeEventListener('submit', instance.onSubmit);
    instance.cleanup.forEach((cleanup) => cleanup());
    formInstances.delete(form);
  });
}

export { initFormValidation, destroy };
export default initFormValidation;
