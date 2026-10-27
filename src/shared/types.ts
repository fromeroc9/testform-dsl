export interface VariableInfo {
  name: string;
  type?: string;
  description?: string;
  defaultValue?: any;
  sourceFile: string;
  line: number;
}

export interface LocalInfo {
  name: string;
  expression: string;
  sourceFile: string;
  line: number;
}

export interface DataInfo {
  type: string;
  name: string;
  sourceFile: string;
  line: number;
}

export interface TestformWorkspaceConfig {
  variables: Map<string, VariableInfo>;
  locals: Map<string, LocalInfo>;
  dataSources: Map<string, DataInfo>;
  scopes: {
    testcase: string;
    testrun: string;
    testplan: string;
  };
}

export interface TestformStateResource {
  type: string;
  name: string;
  provider: string;
  attributes: Record<string, any>;
  tainted?: boolean;
}

export interface TestformState {
  version: number;
  testform_version?: string;
  serial?: number;
  resources: TestformStateResource[];
}
