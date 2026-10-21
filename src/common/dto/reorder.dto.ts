import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, Max, Min } from 'class-validator'
import { MAX_INT_ID } from '../constants/database'

/** New order of a list of siblings: the position in `ids` becomes each row's sortOrder. */
export class ReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(MAX_INT_ID, { each: true })
  ids: number[]
}
