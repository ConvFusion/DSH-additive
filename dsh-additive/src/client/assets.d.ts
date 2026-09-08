/** esbuild's `base64` loader turns an image import into a raw base64 string. */
declare module '*.png' {
  const base64: string
  export default base64
}
