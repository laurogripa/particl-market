// Copyright (c) 2017-2019, The Particl Market developers
// Distributed under the GPL software license, see the accompanying
// file COPYING or https://github.com/particl/particl-market/blob/develop/LICENSE

import * as resources from 'resources';
import { inject, named } from 'inversify';
import { RpcRequest } from '../../requests/RpcRequest';
import { RpcCommandInterface } from '../RpcCommandInterface';
import { validate, request } from '../../../core/api/Validate';
import { Logger as LoggerType } from '../../../core/Logger';
import { Types, Core, Targets } from '../../../constants';
import { BaseCommand } from '../BaseCommand';
import { Commands } from '../CommandEnumType';
import { MarketService } from '../../services/model/MarketService';
import { MissingParamException } from '../../exceptions/MissingParamException';
import { InvalidParamException } from '../../exceptions/InvalidParamException';
import { ModelNotFoundException } from '../../exceptions/ModelNotFoundException';
import { MessageException } from '../../exceptions/MessageException';

export class MarketRemoveCommand extends BaseCommand implements RpcCommandInterface<void> {

    public log: LoggerType;

    constructor(
        @inject(Types.Service) @named(Targets.Service.model.MarketService) private marketService: MarketService,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        super(Commands.MARKET_REMOVE);
        this.log = new Logger(__filename);
    }

    /**
     * data.params[]:
     *  [0]: market: resources.Market
     *
     * @param data
     * @returns {Promise<void>}
     */
    @validate()
    public async execute( @request(RpcRequest) data: RpcRequest): Promise<void> {
        const market: resources.Market = data.params[0];

        // TODO: add removal of all other market related data
        return this.marketService.destroy(market.id);
    }

    /**
     * data.params[]:
     *  [0]: marketId
     *
     * @param data
     * @returns {Promise<RpcRequest>}
     */
    public async validate(data: RpcRequest): Promise<RpcRequest> {

        // make sure the required params exist
        if (data.params.length < 1) {
            throw new MissingParamException('marketId');
        }

        // make sure the params are of correct type
        if (typeof data.params[0] !== 'number') {
            throw new InvalidParamException('marketId', 'number');
        }

        // make sure Market with the id exists
        const market: resources.Market = await this.marketService.findOne(data.params[0])
            .then(value => {
                return value.toJSON();
            })
            .catch(reason => {
                throw new ModelNotFoundException('Market');
            });


        const defaultMarket: resources.Market = await this.marketService.getDefaultForProfile(data.params[0]).then(value => value.toJSON())
            .then(value => {
                return value.toJSON();
            });

        if (market.id === defaultMarket.id) {
            throw new MessageException('Default Market cannot be removed.');
        }

        data.params[0] = market;

        return data;
    }

    public usage(): string {
        return this.getName() + ' <marketId> ';
    }

    public help(): string {
        return this.usage() + ' -  ' + this.description() + ' \n'
            + '    <marketId>                 - The Id of the Market we want to remove. ';
    }

    public description(): string {
        return 'Remove a Market.';
    }

    public example(): string {
        return 'market ' + this.getName() + ' 1 ';
    }
}