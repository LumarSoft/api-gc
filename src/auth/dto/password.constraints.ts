/** bcrypt only uses the first 72 bytes of a password. */
export const PASSWORD_MAX_LENGTH = 72
export const PASSWORD_MIN_LENGTH = 8
/** At least one letter and one number. */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/
