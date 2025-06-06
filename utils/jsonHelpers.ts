export function stringifyBigIntsInObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (typeof obj.toJSON === 'function' && !(obj instanceof Date)) {
    // If an object has a toJSON method (like ethers.BigNumber),
    // JSON.stringify would call it. We want to pre-empt this for BigInts
    // specifically, but let other toJSON methods work as intended.
    // However, this check might be too broad or interact unexpectedly
    // with libraries that use toJSON for non-BigInt serialization.
    // For now, let's assume this is primarily for BigNumber-like objects.
  }

  if (Array.isArray(obj)) {
    return obj.map(stringifyBigIntsInObject);
  }

  const newObj: { [key: string]: any } = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (typeof value === 'bigint') {
        newObj[key] = value.toString();
      } else {
        newObj[key] = stringifyBigIntsInObject(value);
      }
    }
  }
  return newObj;
}
