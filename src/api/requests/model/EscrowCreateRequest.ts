// Copyright (c) 2017-2019, The Particl Market developers
// Distributed under the GPL software license, see the accompanying
// file COPYING or https://github.com/particl/particl-market/blob/develop/LICENSE

import { IsNotEmpty, IsEnum } from 'class-validator';
import { RequestBody } from '../../../core/api/RequestBody';
import { EscrowType } from 'omp-lib/dist/interfaces/omp-enums';
import { EscrowRatioCreateRequest } from './EscrowRatioCreateRequest';
import { ModelRequestInterface } from './ModelRequestInterface';

// tslint:disable:variable-name
export class EscrowCreateRequest extends RequestBody implements ModelRequestInterface {

    @IsNotEmpty()
    public payment_information_id: number;

    @IsEnum(EscrowType)
    @IsNotEmpty()
    public type: EscrowType;

    public secondsToLock: number;

    public ratio: EscrowRatioCreateRequest;

}
// tslint:enable:variable-name
