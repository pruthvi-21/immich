import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { SALT_ROUNDS } from 'src/constants';
import { AssetStatsDto, AssetStatsResponseDto, mapStats } from 'src/dtos/asset.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { UserPreferencesResponseDto, UserPreferencesUpdateDto, mapPreferences } from 'src/dtos/user-preferences.dto';
import {
  UserAdminCreateDto,
  UserAdminDeleteDto,
  UserAdminResponseDto,
  UserAdminSearchDto,
  UserAdminUpdateDto,
  mapUserAdmin,
} from 'src/dtos/user.dto';
import { JobName, UserMetadataKey, UserStatus } from 'src/enum';
import { UserFindOptions } from 'src/repositories/user.repository';
import { BaseService } from 'src/services/base.service';
import { getPreferences, getPreferencesPartial, mergePreferences } from 'src/utils/preferences';

@Injectable()
export class UserAdminService extends BaseService {
  async search(auth: AuthDto, dto: UserAdminSearchDto): Promise<UserAdminResponseDto[]> {
    const users = await this.userRepository.getList({
      id: dto.id,
      withDeleted: dto.withDeleted,
    });
    return users.map((user) => mapUserAdmin(user));
  }

  async create(dto: UserAdminCreateDto): Promise<UserAdminResponseDto> {
    const { notify, ...userDto } = dto;
    const config = await this.getConfig({ withCache: false });
    if (!config.oauth.enabled && !userDto.password) {
      throw new BadRequestException('password is required');
    }

    const user = await this.createUser(userDto);

    await this.eventRepository.emit('user.signup', {
      notify: !!notify,
      id: user.id,
      tempPassword: user.shouldChangePassword ? userDto.password : undefined,
    });

    return mapUserAdmin(user);
  }

  async get(auth: AuthDto, id: string): Promise<UserAdminResponseDto> {
    const user = await this.findOrFail(id, { withDeleted: true });
    return mapUserAdmin(user);
  }

  async update(auth: AuthDto, id: string, dto: UserAdminUpdateDto): Promise<UserAdminResponseDto> {
    const user = await this.findOrFail(id, {});

    if (dto.isAdmin !== undefined && dto.isAdmin !== auth.user.isAdmin && auth.user.id === id) {
      throw new BadRequestException('Admin status can only be changed by another admin');
    }

    if (dto.quotaSizeInBytes && user.quotaSizeInBytes !== dto.quotaSizeInBytes) {
      await this.userRepository.syncUsage(id);
    }

    if (dto.email) {
      const duplicate = await this.userRepository.getByEmail(dto.email);
      if (duplicate && duplicate.id !== id) {
        throw new BadRequestException('Email already in use by another account');
      }
    }

    if (dto.storageLabel) {
      const duplicate = await this.userRepository.getByStorageLabel(dto.storageLabel);
      if (duplicate && duplicate.id !== id) {
        throw new BadRequestException('Storage label already in use by another account');
      }
    }

    if (dto.password) {
      dto.password = await this.cryptoRepository.hashBcrypt(dto.password, SALT_ROUNDS);
    }

    if (dto.pinCode) {
      dto.pinCode = await this.cryptoRepository.hashBcrypt(dto.pinCode, SALT_ROUNDS);
    }

    if (dto.storageLabel === '') {
      dto.storageLabel = null;
    }

    const updatedUser = await this.userRepository.update(id, { ...dto, updatedAt: new Date() });

    return mapUserAdmin(updatedUser);
  }

  async delete(auth: AuthDto, id: string, dto: UserAdminDeleteDto): Promise<UserAdminResponseDto> {
    const { force } = dto;
    await this.findOrFail(id, {});
    if (auth.user.id === id) {
      throw new ForbiddenException('Cannot delete your own account');
    }

    await this.albumRepository.softDeleteAll(id);

    const status = force ? UserStatus.REMOVING : UserStatus.DELETED;
    const user = await this.userRepository.update(id, { status, deletedAt: new Date() });

    if (force) {
      await this.jobRepository.queue({ name: JobName.USER_DELETION, data: { id: user.id, force } });
    }

    return mapUserAdmin(user);
  }

  async restore(auth: AuthDto, id: string): Promise<UserAdminResponseDto> {
    await this.findOrFail(id, { withDeleted: true });
    await this.albumRepository.restoreAll(id);
    const user = await this.userRepository.restore(id);
    return mapUserAdmin(user);
  }

  async getStatistics(auth: AuthDto, id: string, dto: AssetStatsDto): Promise<AssetStatsResponseDto> {
    const stats = await this.assetRepository.getStatistics(id, dto);
    return mapStats(stats);
  }

  async getPreferences(auth: AuthDto, id: string): Promise<UserPreferencesResponseDto> {
    await this.findOrFail(id, { withDeleted: true });
    const metadata = await this.userRepository.getMetadata(id);
    return mapPreferences(getPreferences(metadata));
  }

  async updatePreferences(auth: AuthDto, id: string, dto: UserPreferencesUpdateDto) {
    await this.findOrFail(id, { withDeleted: false });
    const metadata = await this.userRepository.getMetadata(id);
    const newPreferences = mergePreferences(getPreferences(metadata), dto);

    await this.userRepository.upsertMetadata(id, {
      key: UserMetadataKey.PREFERENCES,
      value: getPreferencesPartial(newPreferences),
    });

    return mapPreferences(newPreferences);
  }

  private async findOrFail(id: string, options: UserFindOptions) {
    const user = await this.userRepository.get(id, options);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return user;
  }
}
