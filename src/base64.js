// k6's std decoder requires padding; browser/Node atob also accepts raw base64.
export function createAtob(decode) {
  return value => {
    const text = String(value).replace(/[\t\n\f\r ]/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1 || (text.includes('=') && text.length % 4 !== 0)) {
      throw new TypeError('Invalid base64');
    }
    return String.fromCharCode(...new Uint8Array(decode(text.padEnd(Math.ceil(text.length / 4) * 4, '='), 'std')));
  };
}
