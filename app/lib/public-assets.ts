/** Keep existing root-hosted previews and GitHub Pages subpaths compatible. */
export function publicAsset(path: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `${base}${path}`;
}
