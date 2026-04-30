const randomChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

const toBase64Url = (input: ArrayBuffer): string => {
  const bytes = new Uint8Array(input);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export const generateVerifier = (length = 96): string => {
  const random = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(random)
    .map((num) => randomChars[num % randomChars.length])
    .join('');
};

export const createChallenge = async (verifier: string): Promise<string> => {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64Url(digest);
};
