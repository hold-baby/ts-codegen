import { IComponents, IOpenAPI, IReference } from "src/v3/OpenAPI";
import { CustomType, Enum, Ref } from "src/core/Type";
import { compact, get, isEmpty, keys, mapValues, sortBy } from "lodash";
import { Schema } from "src/core/Schema";
import { getUseExtends, prettifyCode, setDeprecated, toCapitalCase, toTypes } from "src/core/utils";
import { Parameter, Spec } from "swagger-schema-official";
import { CustomSchema, IClientConfig } from "src/core/types";
import { getClientConfigsV2, getClientConfigV3 } from "src";
import { Register } from "src/core/Register";

export const getDeclarationType = (schema: CustomSchema) => {
  if (schema.type === "object" || schema.properties || (schema.allOf && getUseExtends(schema.allOf))) {
    return "interface";
  }
  return "type";
};

const addPrefix = (name: string) => `${Register.prefixes[name] === "interface" ? "I" : "T"}${name}`;

export const getOutput = (): string => {
  let output = "";
  keys(Register.decls)
    .sort()
    .forEach((k) => {
      const t = Register.decls[k];
      if (t instanceof Enum) {
        output = output + `export ${t.toType()}\n\n`;
        return;
      }

      output =
        output +
        `export ${Register.prefixes[k]} ${addPrefix(k)} ${
          Register.prefixes[k] === "interface" ? "" : "="
        } ${t.toType()}${Register.prefixes[k] === "type" ? ";" : ""}\n\n`;
    });
  return output;
};

type KType = { [key: string]: CustomType };

export class Scanner {
  schemaHandler: Schema;

  constructor(private spec: Spec | IOpenAPI) {
    this.schemaHandler = new Schema();
  }

  public scan(): string {
    // TODO: handle v3 base path later
    const basePath = this.spec.basePath || "";
    this.toReusableTypes(this.spec.definitions || (this.spec as IOpenAPI)?.components?.schemas);
    this.handleParameters(this.spec.parameters || (this.spec as IOpenAPI)?.components?.parameters);
    let clientConfigs: IClientConfig[] = this.spec.swagger
      ? getClientConfigsV2(this.spec.paths, basePath)
      : getClientConfigV3(this.spec.paths, basePath);

    for (let name in Register.refs) {
      (Register.refs[name] as Ref).rename(addPrefix(name));
    }

    return prettifyCode(`${this.toRequest(clientConfigs)} \n\n ${getOutput()}`);
  }

  private toReusableTypes(schemas: { [k: string]: CustomSchema | IReference }) {
    return keys(schemas).map((k) => {
      const name = toCapitalCase(k);
      const type = this.schemaHandler.convert(schemas[k], name);
      Register.setType(name, type);
      Register.setPrefix(name, getDeclarationType(schemas[k]));
      return type;
    });
  }

  private toRequest(clientConfigs: IClientConfig[]): string {
    // for (let name in Register.refs) {
    //   if (!(Register.refs[name] as Ref).alias) {
    //     (Register.refs[name] as Ref).rename(addPrefix(name));
    //   }
    // }
    const clientConfig = sortBy(clientConfigs, (o) => o.operationId);

    // TODO: refactor code later
    function mapper(obj: KType | { [key: string]: KType }): any {
      return toTypes(
        mapValues(obj, (v: any) => {
          if (!v.toType) {
            return mapper(v);
          }
          return v.toType(false);
        }),
      );
    }

    return clientConfig
      .map((v: IClientConfig) => {
        const TReq = !isEmpty(v.TReq) ? mapper(v.TReq as any) : "";
        const requestParamList = compact([...v.pathParams, ...v.queryParams, v.contentType ? "requestBody" : ""]);
        const requestInputs = isEmpty(requestParamList) ? "" : toRequestParams(requestParamList);

        const getParams = () => {
          const params = toRequestParams(get(v, "queryParams"));
          return params ? `params: ${params},` : "";
        };

        const getHeaders = () => (v.contentType ? `headers: { "Content-Type": '${v.contentType}' },` : "");

        const types = compact([TReq, v.TResp?.toType(false)]).join(",");
        return `
${v.deprecated ? setDeprecated(v.operationId) : ""}
export const ${v.operationId} = createRequestAction${types ? "<" + types + ">" : ""}("${
          v.operationId
        }", (${requestInputs}) => ({ url: \`${v.url}\`,method: "${v.method}",${
          v.contentType ? `data: requestBody,` : ""
        }${getParams()}${getHeaders()} })
);
`;
      })
      .join("\n\n");
  }

  handleParameters(parameters: Spec["parameters"] | IComponents["parameters"]) {
    if (!parameters) {
      return;
    }

    keys(parameters).forEach((key) => {
      // TODO: resolve parameters[key] later
      Register.setParameter(key, parameters[key] as Parameter);
    });
  }
}

const toRequestParams = (data: any[] = []) =>
  !isEmpty(data)
    ? `{
${data.join(",\n")}
}`
    : undefined;
