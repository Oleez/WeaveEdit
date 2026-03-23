/// <reference types="vite/client" />

interface CepDialogResult {
  data: string[] | string;
  err: number;
}

interface CepFs {
  showOpenDialogEx?: (
    allowMultipleSelection: boolean,
    chooseDirectory: boolean,
    title: string,
    initialPath: string,
    fileTypes: string[],
    friendlyFilePrefix: string[] | string,
  ) => CepDialogResult;
}

interface CepRuntime {
  fs?: CepFs;
}

interface AdobeCepRuntime {
  evalScript?: (script: string, callback: (result: string) => void) => void;
}

interface Window {
  __adobe_cep__?: AdobeCepRuntime;
  cep?: CepRuntime;
  require?: (moduleName: string) => unknown;
}