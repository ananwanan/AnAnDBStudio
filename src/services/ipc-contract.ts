
export const IPC_PROTOCOL_VERSION = 1;

export interface AppInfo {
    readonly appName: string;
    readonly version: string;
    readonly protocolVersion: number;
}

export interface IpcCommands {
    get_app_info: {
        args: undefined;
        result: AppInfo;
    };

    check_ipc_protocol: {
        args: {
            readonly protocolVersion: number;
        };
        result: void;
    };
}

export type IpcCommandName = keyof IpcCommands;

export type IpcCommandArgs<C extends IpcCommandName> =
    IpcCommands[C]["args"];

export type IpcCommandResult<C extends IpcCommandName> =
    IpcCommands[C]["result"];
