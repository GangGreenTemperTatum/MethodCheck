// This declaration file fixes TypeScript errors without modifying the core code logic

declare module "caido:plugin" {
  // Define core types that are missing
  export type DefineAPI<T> = T;
  export type DefineEvents<T> = T;

  // Define the SDK interface for both frontend and backend
  export interface SDK<API = {}, Events = {}> {
    console: {
      log(message: string): void;
      error(message: string): void;
      warn(message: string): void;
    };
    api: {
      register(name: string, fn: Function): void;
      send(event: string, data: any): void;
    };
    events: {
      onInterceptResponse(handler: (sdk: SDK, request: any, response: any) => Promise<void>): void;
    };
    requests: {
      query(): any;
      get(id: string): Promise<any>;
      send(spec: any): Promise<any>;
      setComment?(id: string, comment: string): Promise<void>;
      setTag?(id: string, tag: string): Promise<void>;
    };
    findings: {
      create(finding: any): Promise<any>;
      exists(dedupeKey: string): Promise<boolean>;
    };
    backend: {
      onEvent(event: string, callback: (data: any) => void): void;
    };
    view?: {
      register(options: {
        id: string;
        component: any;
        icon: string;
        title: string;
      }): void;
    };
    menu?: {
      registerItem(options: {
        type: string;
        commandId: string;
        label: string;
        leadingIcon: string;
      }): void;
    };
    httpql?: {
      extendMetadata(options: {
        tags: Array<{
          id: string;
          name: string;
          description: string;
          color: string;
        }>;
      }): void;
    };
  }
}

// Define caido:utils module
declare module "caido:utils" {
  export class RequestSpec {
    constructor(url: string);
    setMethod(method: string): void;
    setHeader(name: string, value: string): void;
    getHost(): string;
    getPort(): number;
    getPath(): string;
    getHeaders(): Record<string, string[]>;
  }
}

// Add global functions that are missing
declare function setInterval(callback: (...args: any[]) => void, ms: number): number;
declare function clearInterval(id: number): void;

// Update onEvent callback type
declare module "../../backend/src/index" {
  interface MethodCheckEvent {
    requestId: string;
    url: string;
    originalMethod: string;
    availableMethods: string[];
  }
}
