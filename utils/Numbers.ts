/**
 * @name formatNumber
 * @description Format a number to have two digits
 * @param {number} number
 * @returns {string} formatted number
 */
export const formatNumber = (number: number): string => {
  return number.toString().padStart(2, '0');
};

/**
 * @name stringifyWithBigInt
 * @description Stringify an object with BigInt support
 * @param {unknown} obj
 * @returns {string} stringified object
 */
export const stringifyWithBigInt = (obj: unknown): string => {
  return JSON.stringify(
    obj,
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  );
};
