export const textWithTrailingLineMarker = (text: string) =>
  /(?:\r\n?|\n)$/.test(text) ? `${text}\u200b` : text;
