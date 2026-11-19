import { Body, Controller, Get, Inject, NotFoundException, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';
import { ALL_ROLES, type Role } from '@schroeder/shared';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { ZodPipe } from '../common/zod.js';
import { DEV_PERSONAS } from '../seed/personas.js';
import { Public } from './decorators.js';
import { TokenVerifier } from './token-verifier.js';

const devTokenBody = z.object({
  oid: z.string().uuid(),
  name: z.string().default('Dev User'),
  email: z.string().default('dev@example.invalid'),
  roles: z.array(z.enum(ALL_ROLES as [Role, ...Role[]])).default([]),
});

/** Local sign-in for development and automated tests. Returns 404 unless AUTH_MODE=dev. */
@ApiExcludeController()
@Controller('dev')
export class DevAuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
  ) {}

  private ensureDev() {
    if (this.config.AUTH_MODE !== 'dev' || this.config.APP_ENV === 'prod') throw new NotFoundException();
  }

  @Public()
  @Get('personas')
  personas() {
    this.ensureDev();
    return DEV_PERSONAS;
  }

  @Public()
  @Post('token')
  async token(@Body(new ZodPipe(devTokenBody)) body: z.infer<typeof devTokenBody>) {
    this.ensureDev();
    return { accessToken: await this.verifier.issueDevToken(body), tokenType: 'Bearer' };
  }
}
