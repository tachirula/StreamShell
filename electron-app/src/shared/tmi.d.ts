declare module 'tmi.js' {
  export interface ChatIdentity {
    username: string
    password: string
  }

  export interface ClientOptions {
    channels: string[]
    identity?: ChatIdentity
  }

  export class Client {
    constructor(options: ClientOptions)
    connect(): Promise<[string, number]>
    disconnect(): Promise<void>
    getUsername(): string | null
    say(channel: string, message: string): Promise<unknown>
    on(event: 'connected', listener: (address: string, port: number) => void): this
    on(event: 'join', listener: (channel: string, username: string, self: boolean) => void): this
    on(
      event: 'notice',
      listener: (channel: string, messageId: string, message: string) => void
    ): this
    on(event: 'disconnected', listener: (reason: string) => void): this
    on(
      event: 'message',
      listener: (
        channel: string,
        tags: Record<string, unknown>,
        message: string,
        self: boolean
      ) => void
    ): this
  }
}
