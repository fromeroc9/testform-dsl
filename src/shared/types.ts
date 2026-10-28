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

export interface ScenarioIdentityInfo {
  tag: string;         // e.g. "@tc-1"
  idNumber: number;    // e.g. 1
  scope: 'testcase' | 'testrun' | 'testplan';
  title: string;       // e.g. "Inicio de sesión exitoso con usuario estándar"
  address: string;     // e.g. "auth/login.case.feature.@tc-1"
  sourceFile: string;  // absolute path
  line: number;        // 0-based line number in file
}

export interface TestformWorkspaceConfig {
  variables: Map<string, VariableInfo>;
  locals: Map<string, LocalInfo>;
  dataSources: Map<string, DataInfo>;
  scenarios: Map<string, ScenarioIdentityInfo>;
  scenarioAddresses: Map<string, ScenarioIdentityInfo>;
  duplicateScenarioTags: Map<string, string[]>; // tag -> list of "file:line"
  maxIdentityIds: {
    tc: number;
    tr: number;
    tp: number;
  };
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
