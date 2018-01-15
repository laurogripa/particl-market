import { inject, multiInject, named } from 'inversify';
import { Logger as LoggerType } from '../../core/Logger';
import { Types, Core, Targets } from '../../constants';
import { MessageProcessorInterface } from './MessageProcessorInterface';
import { ActionMessageInterface } from '../messages/ActionMessageInterface';
import { CoreRpcService } from '../services/CoreRpcService';

export class MessageProcessor implements MessageProcessorInterface {

    public log: LoggerType;

    private timeout: any;
    private interval = 3000;

    constructor(
        @inject(Types.Service) @named(Targets.Service.CoreRpcService) private coreRpcService: CoreRpcService,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        this.log = new Logger(__filename);
    }

    public process(message: ActionMessageInterface): void {
        //
    }

    public stop(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
    }

    public schedulePoll(): void {
        this.timeout = setTimeout(
            async () => {
                await this.poll();
                console.log('polled, scheduling next');
                this.schedulePoll();
            },
            this.interval
        );
    }

    /**
     * main poll
     *
     * @returns {Promise<void>}
     */
    private async poll(): Promise<void> {
        await this.pollMessages()
            .then((messages) => {
                this.log.info('response: ', messages);
            })
            .catch(reason => {
                this.log.info('error: ', reason);
            });
        return;
    }

    private async pollMessages(): Promise<any> {
        this.log.debug('polling getnetworkinfo: ', this.interval);

        return await this.coreRpcService.call('getnetworkinfo')
            .then((response) => {
                this.log.info('got response:', JSON.stringify(response));
                return response;
            })
            .catch(reason => {
                this.log.error('got error:', reason);
                return reason;
            });
    }
}
