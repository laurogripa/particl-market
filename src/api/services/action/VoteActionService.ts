// Copyright (c) 2017-2019, The Particl Market developers
// Distributed under the GPL software license, see the accompanying
// file COPYING or https://github.com/particl/particl-market/blob/develop/LICENSE

import * as _ from 'lodash';
import * as resources from 'resources';
import { inject, named } from 'inversify';
import { Logger as LoggerType } from '../../../core/Logger';
import { Core, Targets, Types } from '../../../constants';
import { VoteCreateRequest } from '../../requests/model/VoteCreateRequest';
import { SmsgService } from '../SmsgService';
import { MarketplaceMessage } from '../../messages/MarketplaceMessage';
import { EventEmitter } from 'events';
import { MarketplaceMessageEvent } from '../../messages/MarketplaceMessageEvent';
import { VoteFactory } from '../../factories/model/VoteFactory';
import { VoteService } from '../model/VoteService';
import { SmsgSendResponse } from '../../responses/SmsgSendResponse';
import { CoreRpcService } from '../CoreRpcService';
import { MessageException } from '../../exceptions/MessageException';
import { VoteMessage } from '../../messages/action/VoteMessage';
import { ProposalService } from '../model/ProposalService';
import { ProposalOptionService } from '../model/ProposalOptionService';
import { ProposalCategory } from '../../enums/ProposalCategory';
import { ListingItemService } from '../model/ListingItemService';
import { SmsgMessageService } from '../model/SmsgMessageService';
import { SmsgMessageStatus } from '../../enums/SmsgMessageStatus';
import { ProposalResultService } from '../model/ProposalResultService';
import { VoteUpdateRequest } from '../../requests/model/VoteUpdateRequest';
import { VoteMessageFactory } from '../../factories/message/VoteMessageFactory';
import { VoteCreateParams } from '../../factories/model/ModelCreateParams';
import { ompVersion } from 'omp-lib/dist/omp';
import { GovernanceAction } from '../../enums/GovernanceAction';
import { VoteMessageCreateParams } from '../../requests/message/VoteMessageCreateParams';
import { BaseActionService } from './BaseActionService';
import { SmsgMessageFactory } from '../../factories/model/SmsgMessageFactory';
import { VoteRequest } from '../../requests/action/VoteRequest';
import { RpcUnspentOutput } from 'omp-lib/dist/interfaces/rpc';
import { VoteValidator } from '../../messages/validator/VoteValidator';

export interface VoteTicket {
    proposalHash: string;       // proposal being voted for
    proposalOptionHash: string; // proposal option being voted for
    address: string;            // voting address having balance
}

export interface AddressInfo {
    address: string;
    balance: number;            // in satoshis
}

export class VoteActionService extends BaseActionService {

    constructor(
        @inject(Types.Service) @named(Targets.Service.SmsgService) public smsgService: SmsgService,
        @inject(Types.Service) @named(Targets.Service.model.SmsgMessageService) public smsgMessageService: SmsgMessageService,
        @inject(Types.Factory) @named(Targets.Factory.model.SmsgMessageFactory) public smsgMessageFactory: SmsgMessageFactory,
        @inject(Types.Core) @named(Core.Events) public eventEmitter: EventEmitter,

        @inject(Types.Factory) @named(Targets.Factory.message.VoteMessageFactory) private voteMessageFactory: VoteMessageFactory,
        @inject(Types.Factory) @named(Targets.Factory.model.VoteFactory) private voteFactory: VoteFactory,
        @inject(Types.Service) @named(Targets.Service.CoreRpcService) public coreRpcService: CoreRpcService,
        @inject(Types.Service) @named(Targets.Service.model.ProposalService) public proposalService: ProposalService,
        @inject(Types.Service) @named(Targets.Service.model.ProposalResultService) public proposalResultService: ProposalResultService,
        @inject(Types.Service) @named(Targets.Service.model.ProposalOptionService) public proposalOptionService: ProposalOptionService,
        @inject(Types.Service) @named(Targets.Service.model.VoteService) public voteService: VoteService,
        @inject(Types.Service) @named(Targets.Service.model.ListingItemService) public listingItemService: ListingItemService,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        super(smsgService, smsgMessageService, smsgMessageFactory);
        this.log = new Logger(__filename);
    }

    /**
     * create the MarketplaceMessage to which is to be posted to the network
     *
     * @param params
     */
    public async createMessage(params: VoteRequest): Promise<MarketplaceMessage> {

        const signature = await this.signVote(params.proposal, params.proposalOption, params.addressInfo.address);

        const actionMessage: VoteMessage = await this.voteMessageFactory.get({
            proposalHash: params.proposal.hash,
            proposalOptionHash: params.proposalOption.hash,
            voter: params.addressInfo.address,
            signature
        } as VoteMessageCreateParams);

        return {
            version: ompVersion(),
            action: actionMessage
        } as MarketplaceMessage;
    }

    /**
     * validate the MarketplaceMessage to which is to be posted to the network
     *
     * @param marketplaceMessage
     */
    public async validateMessage(marketplaceMessage: MarketplaceMessage): Promise<boolean> {
        return VoteValidator.isValid(marketplaceMessage);
    }

    /**
     * called before post is executed and message is sent
     *
     * @param params
     * @param marketplaceMessage
     */
    public async beforePost(params: VoteRequest, marketplaceMessage: MarketplaceMessage): Promise<MarketplaceMessage> {

        if (!params.sendParams.estimateFee) {
            // processVote "processes" the Vote, creating or updating the Vote.
            // called from send() and onEvent()
            await this.processVote(marketplaceMessage.action as VoteMessage);
        } else {
            // if we're just estimating the price, dont save the Proposal
        }

        return marketplaceMessage;
    }


    /**
     * called after post is executed and message is sent
     *
     * @param params
     * @param marketplaceMessage
     * @param smsgSendResponse
     */
    public async afterPost(params: VoteRequest, marketplaceMessage: MarketplaceMessage, smsgSendResponse: SmsgSendResponse): Promise<SmsgSendResponse> {

        if (smsgSendResponse.msgid) {
            await this.voteService.updateMsgId((marketplaceMessage.action as VoteMessage).signature, smsgSendResponse.msgid);
        } else {
            throw new MessageException('Failed to set Proposal msgid');
        }

        return smsgSendResponse;
    }

    /**
     * handles the received VoteMessage and returns SmsgMessageStatus as a result
     *
     * TODO: check whether returned SmsgMessageStatuses actually make sense and the responses to those
     *
     * @param event
     */
    public async onEvent(event: MarketplaceMessageEvent): Promise<SmsgMessageStatus> {

        const smsgMessage: resources.SmsgMessage = event.smsgMessage;
        const marketplaceMessage: MarketplaceMessage = event.marketplaceMessage;
        const actionMessage: VoteMessage = marketplaceMessage.action as VoteMessage;

        // processProposal will create or update the Proposal
        return await this.processVote(actionMessage, smsgMessage)
            .then(vote => {
                if (vote) {
                    this.log.debug('==> PROCESSED VOTE: ', vote.signature);
                }
                this.log.debug('==> PROCESSED VOTE, with no weight. vote ignored.');
                return SmsgMessageStatus.PROCESSED;
            })
            .catch(reason => {
                this.log.debug('==> VOTE PROCESSING FAILED: ', reason);
                return SmsgMessageStatus.PROCESSING_FAILED;
            });
    }

    /**
     *
     * @param profile
     * @param proposal
     */
    public async getCombinedVote(profile: resources.Profile, proposal: resources.Proposal): Promise<resources.Vote> {

        // TODO: move this and getWalletAddressInfos elsewhere, maybe VoteService
        const addressInfos: AddressInfo[] = await this.getWalletAddressInfos();
        const addresses = addressInfos.map(addressInfo => {
            return addressInfo.address;
        });

        const votes: resources.Vote[] = await this.voteService.findAllByVotersAndProposalHash(addresses, proposal.hash)
            .then(value => value.toJSON());

        if (_.isEmpty(votes)) {
            throw new MessageException('No Votes found.');
        }

        const combinedVote = {
            id: 0,
            voter: profile.address,
            weight: 0,
            postedAt: Date.now(),
            receivedAt: Date.now(),
            expiredAt: Date.now(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ProposalOption: {} as resources.ProposalOption
        } as resources.Vote;

        for (const vote of votes) {
            combinedVote.weight = combinedVote.weight + vote.weight;
            combinedVote.ProposalOption = vote.ProposalOption;
        }

        return combinedVote;
    }

    /**
     * vote for given Proposal and ProposalOption using all wallet addresses
     *
     * - vote( profile, ... ):
     *   - get all addresses having balance
     *   - for (voteAddress: addresses):
     *     - this.send( voteAddress )
     *
     * TODO: add support to Vote using selected wallet/profile
     *
     * @param voteRequest
     */
    public async vote(voteRequest: VoteRequest): Promise<SmsgSendResponse> {

        const addressInfos: AddressInfo[] = await this.getWalletAddressInfos();

        this.log.debug('posting votes from addresses: ', JSON.stringify(addressInfos, null, 2));
        if (_.isEmpty(addressInfos)) {
            throw new MessageException('Wallet has no usable addresses for voting.');
        }

        const msgids: string[] = [];
        for (const addressInfo of addressInfos) {
            if (addressInfo.balance > 0) {
                // change sender to be the output address, then post the vote
                voteRequest.sendParams.fromAddress = addressInfo.address;
                await this.post(voteRequest)
                    .then(smsgSendResponse => {
                        if (smsgSendResponse.msgid) {
                            msgids.push(smsgSendResponse.msgid);
                        }
                    });
            }
        }

        if (msgids.length === 0) {
            throw new MessageException('Wallet has no usable addresses for voting.');
        }

        const result = {
            result: 'Sent.',
            msgids
        } as SmsgSendResponse;

        this.log.debug('vote(), result: ', JSON.stringify(result, null, 2));
        return result;
    }

    /**
     * processVote "processes" the Vote, creating or updating the Vote.
     * called from send() and processVoteReceivedEvent(), meaning before the VoteMessage is sent
     * and after the VoteMessage is received.
     *
     * - private processVote()
     *   - verify the vote is valid
     *     - verifymessage address votemessage.signature votemessage.voteticket
     *     - get the balance for the address
     *   - if Vote is valid and has balance:
     *     - save/update Vote locally (update: add the fields from smsgmessage)
     *     - proposalService.recalculateProposalResult(proposal)
     *     - if ITEM_VOTE
     *       - check if listingitem should be removed
     *
     * @param voteMessage
     * @param smsgMessage
     */
    private async processVote(voteMessage: VoteMessage, smsgMessage?: resources.SmsgMessage): Promise<resources.Vote | undefined> {

        // TODO: dont return undefined
        // TODO: way too long method, needs to be refactored

        // get the address balance
        const balance = await this.coreRpcService.getAddressBalance([voteMessage.voter])
            .then(value => value.balance);

        // verify that the vote was actually sent by the owner of the address
        const verified = await this.verifyVote(voteMessage);
        if (!verified) {
            throw new MessageException('Received signature failed validation.');
        }

        let proposal: resources.Proposal = await this.proposalService.findOneByHash(voteMessage.proposalHash)
            .then(value => value.toJSON());

        if (smsgMessage && smsgMessage.sent > proposal.expiredAt) {
            this.log.debug('proposal.expiredAt: ' + proposal.expiredAt + ' < ' + 'smsgMessage.sent: ' + smsgMessage.sent);
            // smsgMessage -> message was received, there's no smsgMessage if the vote was just saved locally
            // smsgMessage.sent > proposal.expiredAt -> message was sent after expiration
            throw new MessageException('Vote is invalid, it was sent after Proposal expiration.');
        }

        // address needs to have balance for the vote to matter
        // already checked in send, but doing it again since we call this also from onEvent()
        if (balance > 0) {

            const votedProposalOption = await this.proposalOptionService.findOneByHash(voteMessage.proposalOptionHash)
                .then(value => value.toJSON());

            // find the vote and if it exists, update it, and if not, then create it
            let vote: resources.Vote | undefined = await this.voteService.findOneByVoterAndProposalId(voteMessage.voter, proposal.id)
                // empty .catch() wont work!
                .catch(reason => this.log.debug('Vote not found: ', reason))
                .then(value => {
                    if (value) {
                        return value.toJSON();
                    }
                });

            // todo: createOrUpdateVote
            if (vote) {
                // Vote was found, update it
                // when vote is found, we are either receiving our own vote or someone is voting again
                // if this is our own vote, then the relevant smsgMessage data will be updated and included in the request
                const voteUpdateRequest: VoteUpdateRequest = await this.voteFactory.get({
                        proposalOption: votedProposalOption,
                        weight: balance,
                        create: false
                    } as VoteCreateParams,
                    voteMessage,
                    smsgMessage);
                this.log.debug('found vote, updating the existing one');
                this.log.debug('voteRequest.voter: ' + voteUpdateRequest.voter);
                this.log.debug('proposal.id: ' + proposal.id);
                vote = await this.voteService.update(vote.id, voteUpdateRequest)
                    .then(value => {
                        return value.toJSON();
                    });

            } else {
                // Vote doesnt exist yet, so we need to create it.
                // when called from send() we create a VoteCreateRequest with fake smsgMessage data, which will be updated when the message is received.
                this.log.debug('did not find vote, creating...');
                const voteCreateRequest: VoteCreateRequest = await this.voteFactory.get({
                        msgid: smsgMessage ? smsgMessage.msgid : '',
                        proposalOption: votedProposalOption,
                        weight: balance,
                        create: true
                    } as VoteCreateParams,
                    voteMessage,
                    smsgMessage);

                vote = await this.voteService.create(voteCreateRequest)
                    .then(value => {
                        return value.toJSON();
                    });
                // this.log.debug('created vote: ', JSON.stringify(vote, null, 2));
            }

            if (vote) {
                // after creating/updating the Vote, recalculate the ProposalResult
                proposal = await this.proposalService.findOne(vote.ProposalOption.Proposal.id)
                    .then(value => value.toJSON());
                const proposalResult: resources.ProposalResult = await this.proposalService.recalculateProposalResult(proposal);

                // after recalculating the ProposalResult, if proposal is of category ITEM_VOTE,
                // we can now check whether the ListingItem should be removed or not
                if (proposal.category === ProposalCategory.ITEM_VOTE) {
                    const listingItem: resources.ListingItem = await this.listingItemService.findOneByHash(proposalResult.Proposal.item)
                        .then(value => value.toJSON());
                    await this.proposalResultService.shouldRemoveListingItem(proposalResult, listingItem)
                        .then(async remove => {
                            if (remove) {
                                await this.listingItemService.destroy(listingItem.id);
                            }
                        });
                }
                return vote;
            }
        }

        // returning undefined vote in case there's no balance
        // we could also throw in this situation
        return;
    }


    /**
     * get the Profiles wallets addresses
     * minimum 3 confirmations, ones without balance not included
     *
     * the profile param is not used for anything yet, but included already while we wait and build multiwallet support
     *
     * @param addresses
     */
    private async getWalletAddressInfos(addresses: string[] = []): Promise<AddressInfo[]> {
        const addressList: AddressInfo[] = [];
        const outputs: RpcUnspentOutput[] = await this.coreRpcService.listUnspent(1, 9999999, addresses);
        // this.log.debug('getProfileAddressInfos(), outputs: ', JSON.stringify(outputs, null, 2));

        for (const output of outputs) {
            if (output.spendable && output.solvable && output.safe && output.amount > 0) {
                // we could have multiple outputs from one address and we only want to send one Vote per address.
                const exists = addressList.find(addressInfo => addressInfo.address === output.address);
                if (!exists) {
                    addressList.push({
                        address: output.address,
                        balance: output.amount * 100000000 // in satoshis
                    } as AddressInfo);
                }
            }
        }
        return addressList;
        // const validChars = 'pP';
        // return addressList.filter(address => validChars.includes(address.charAt(0)));
    }

    /**
     * signs the VoteTicket, returns signature
     *
     * @param proposal
     * @param proposalOption
     * @param address
     */
    private async signVote(proposal: resources.Proposal, proposalOption: resources.ProposalOption, address: string): Promise<string> {
        const voteTicket = {
            proposalHash: proposal.hash,
            proposalOptionHash: proposalOption.hash,
            address
        } as VoteTicket;

        return await this.coreRpcService.signMessage(address, voteTicket);
    }

    /**
     * verifies VoteTicket, returns boolean
     *
     * @param voteMessage
     * @param address
     */
    private async verifyVote(voteMessage: VoteMessage): Promise<boolean> {
        const voteTicket = {
            proposalHash: voteMessage.proposalHash,
            proposalOptionHash: voteMessage.proposalOptionHash,
            address: voteMessage.voter
        } as VoteTicket;
        return await this.coreRpcService.verifyMessage(voteMessage.voter, voteMessage.signature, voteTicket);
    }

}
