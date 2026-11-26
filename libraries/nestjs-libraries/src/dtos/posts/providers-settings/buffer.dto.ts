import { IsBoolean, IsOptional } from 'class-validator';

export class BufferDto {
  @IsOptional()
  @IsBoolean()
  isAiGenerated?: boolean;

}
