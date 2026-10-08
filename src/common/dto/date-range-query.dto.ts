import { IsOptional, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator'
import { isCalendarDay } from '../utils/report-period'

@ValidatorConstraint({ name: 'calendarDay' })
class CalendarDay implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isCalendarDay(value)
  }
  defaultMessage(): string {
    return '$property must be a calendar day (YYYY-MM-DD)'
  }
}

/** Argentine calendar days of a report, both included. Both or none (none = the last 30 days up to today). */
export class DateRangeQueryDto {
  @IsOptional()
  @Validate(CalendarDay)
  from?: string

  @IsOptional()
  @Validate(CalendarDay)
  to?: string
}
