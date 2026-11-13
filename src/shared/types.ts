import { IdentityConfigMap, ResourceScope } from './identity';

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
  tag: string;         // e.g. "@tc-1" or "@flaviotag-1"
  normalizedTag?: string; // zero-padded-stripped lowercase form e.g. "@flaviotag-1"
  idNumber: number;    // e.g. 1 (0 if non-numeric custom suffix)
  scope: ResourceScope;
  title: string;       // e.g. "Inicio de sesión exitoso con usuario estándar"
  address: string;     // e.g. "auth/login.case.feature.@tc-1"
  sourceFile: string;  // absolute path
  line: number;        // 0-based line number in file
  namespace?: string;  // e.g. "pix" from @ns(pix)
  delimitedAddress?: string; // e.g. "auth/login.case.feature.@tc-1"
  namespaceAddress?: string; // e.g. "pix.login.case.feature.@tc-1"
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
    bg: number;
  };
  maxIdentityByScope: Record<ResourceScope, number>;
  identities: IdentityConfigMap;
  scopes: {
    testcase: string;
    testrun: string;
    testplan: string;
    bug: string;
  };
  scaffoldDirectories?: {
    testcase?: string;
    testrun?: string;
    testplan?: string;
    bug?: string;
  };
  targetFormat?: 'tag' | 'canonical' | 'basename' | 'namespace' | 'tag-bare' | 'file-tag' | 'slug-tag' | 'name' | 'short' | 'classic';
}

export interface TestformStateResource {
  type: string;
  address: string;
  path: string;
  tag?: string;
  physicalAddress?: string;
  namespace?: string;
  identity?: string;
  name?: string;
  provider?: string;
  attributes: Record<string, any>;
  tainted?: boolean;
  lastApplied?: string;
}

export interface TestformState {
  version: number;
  testform_version?: string;
  serial?: number;
  resources: TestformStateResource[];
}
