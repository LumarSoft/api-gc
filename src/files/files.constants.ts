/** Folder (inside STORAGE_DIR) served publicly at /files. Private files will live in a sibling folder. */
export const PUBLIC_FILES_FOLDER = 'public'

/** Largest image accepted by the admin upload: 5 MB. Product photos are optimized by the front when served. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Folder inside public storage for images uploaded from the admin panel. */
export const UPLOADS_FOLDER = 'uploads'
