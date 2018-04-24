import * as express from 'express';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Container } from 'inversify';
import { InversifyExpressServer } from 'inversify-express-utils';
import { Logger } from './Logger';
import { LoggerConfig } from '../config/LoggerConfig';
import { Bootstrap } from './Bootstrap';
import { Server } from './Server';
import { IoC } from './IoC';
import { AppConfig } from '../config/AppConfig';
import { Types, Core } from '../constants';
import { EventEmitter } from './api/events';
import { ServerStartedListener } from '../api/listeners/ServerStartedListener';
import { Environment } from './helpers/Environment';
import { SocketIoServer } from './SocketIoServer';
import { DataDir } from './helpers/DataDir';


export interface Configurable {
    configure(app: App): void;
}

export class App {

    private express: express.Application = express();
    private server: Server;
    private socketIoServer: SocketIoServer;
    private inversifyExpressServer: InversifyExpressServer;
    private ioc: IoC = new IoC();
    private log: Logger = new Logger(__filename);
    private bootstrapApp = new Bootstrap();
    private configurations: Configurable[] = [];

    constructor(dataDir?: string) {

        // loads the .env file into the 'process.env' variable.
        if (false) {
            // Kewde: I'm leaving this as it is right now, not to mess with tests.
            // dotenv.config({path: './test/.env.test'});
        } else {
            if (dataDir) {
                DataDir.set(dataDir);
            } else {
                dataDir = DataDir.getDataDirPath();

            }
            const envfile = path.join(dataDir, '.env');
            console.log('particl-market env file path:', envfile);
            dotenv.config({path: envfile});
        }

        // Configure the logger, because we need it already.
        const loggerConfig = new LoggerConfig();
        loggerConfig.configure();

        // Create express app
        this.log.info('NODE_ENV: ' + process.env.NODE_ENV);
        this.log.info('Defining app...');
        if (!Environment.isTest()) {
            this.bootstrapApp.defineExpressApp(this.express);
        }
    }

    get IoC(): Container {
        return this.ioc.container;
    }

    get Express(): express.Application {
        return this.express;
    }

    get Server(): Server {
        return this.server;
    }

    public Logger(scope: string): Logger {
        return new Logger(scope || __filename);
    }

    public configure(configurations: Configurable): void {
        this.configurations.push(configurations);
    }

    /**
     * ..called from app.ts
     *
     * @returns {Promise<EventEmitter>}
     */
    public async bootstrap(): Promise<any> {
        this.log.info('Configuring app...');

        if (!Environment.isTest()) {
            // Add express monitor app
            this.bootstrapApp.setupMonitor(this.express);
            // Configure the app config for all the middlewares
            const appConfig = new AppConfig();
            appConfig.configure(this);
            // Configure all custom configurations
            this.configurations.forEach((c) => c.configure(this));
        }

        // Setup the ioc of inversify
        this.log.info('Binding IoC modules...');
        await this.ioc.bindModules();

        if (!Environment.isTest()) {
            this.log.info('Setting up IoC...');
            this.inversifyExpressServer = this.bootstrapApp.setupInversifyExpressServer(this.express, this.ioc);
            this.express = this.bootstrapApp.bindInversifyExpressServer(this.express, this.inversifyExpressServer);
            this.bootstrapApp.setupCoreTools(this.express);
            this.log.info('Starting app...');

            this.server = new Server(this.bootstrapApp.startServer(this.express));
            this.server.use(this.express);

            // create our socketioserver
            this.socketIoServer = this.bootstrapApp.createSocketIoServer(this.server, this.ioc);
        }

        this.log.info('App is ready!');

        const eventEmitter = this.ioc.container.getNamed<EventEmitter>(Types.Core, Core.Events);
        eventEmitter.emit(ServerStartedListener.Event, 'Hello!');

        return eventEmitter;
    }

}
