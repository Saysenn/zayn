/**
 * The one company key, as the API has it (api/v1/shared/companyKey.js):
 * lower-cased, only a-z and 0-9 kept. Used for company page links.
 */
export const companyKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
