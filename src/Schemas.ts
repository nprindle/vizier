// A set of data-oriented combinators for building up complex schemas

import { Schema, InjectSchema, DomainOf, ReprOf } from "./Schema";
import { NonEmptyArray, id, impossible } from "./Utils";

/**
 * The possible types of the keys of an object
 */
type PrimKey = string | number | symbol;

// Ugly helper types for object- or tuple-based schemas
type RecordDomains<R extends Record<string, Schema<unknown, unknown>> | Schema<unknown, unknown>[]> = {
    // Replace the schemas in an object/array with the domains of the schemas
    [K in keyof R]: R[K] extends Schema<infer A, unknown> ? A : never;
} & {};
type RecordReprs<R extends Record<string, Schema<unknown, unknown>> | Schema<unknown, unknown>[]> = {
    // Replace the schemas in an object/array with the representations of the schemas
    [K in keyof R]: R[K] extends Schema<unknown, infer B> ? B : never;
} & {};

/**
 * Basic schema constructor function. It is also possible to just make the
 * object containing the functions directly, but this may be considered more
 * declarative.
 */
export function schema<T, S>(args: {
    encode: (val: T) => S;
    decode: (data: S) => T;
    validate: (data: unknown) => data is S;
}): Schema<T, S> {
    return args;
}

/**
 * Function to construct trivial schemas for representable primitive types.
 */
export function primitive<T>(validate: (data: unknown) => data is T): Schema<T, T> {
    return { encode: id, decode: id, validate };
}

/**
 * Function to convert a literal value into a schema that validates that
 * value. Equality is determined based on the requirements of Object.is().
 * If looser equality is needed, use 'primitive'.
 */
export function literal<T>(value: T): Schema<T, T> {
    return { encode: id, decode: id, validate: (x: unknown): x is T => Object.is(x, value) };
}

/**
 * Transform a schema in the contravariant position to encoding; given a way
 * to encode and decode from a new domain type to the old domain type,
 * produce a new schema that has the new domain type.
 */
export function contra<U, T, S>(
    schema: Schema<T, S>,
    encode: (val: U) => T,
    decode: (data: T) => U,
): Schema<U, S> {
    return {
        encode: (x: U): S => schema.encode(encode(x)),
        decode: (x: S): U => decode(schema.decode(x)),
        validate: (data: unknown): data is S => schema.validate(data),
    };
}

/**
 * Transform a schema in the covariant position to encoding; given a way to
 * encode and decode from a new representation type to the old
 * representation type, and a new validator, produce a new schema that has
 * the new representation type.
 */
export function co<T, S, U>(
    schema: Schema<T, S>,
    encode: (val: S) => U,
    decode: (data: U) => S,
    validate: (data: unknown) => data is U,
): Schema<T, U> {
    return {
        encode: (x: T): U => encode(schema.encode(x)),
        decode: (x: U): T => schema.decode(decode(x)),
        validate
    };
}

/**
 * Pushes the evaluation of a schema into its individual functions, for use
 * with recursive structures. Note that if the 'schema' computation is very
 * expensive, this may be inefficient for aggregate schemas, such as
 * 'arrayOf'; in this case, use the lazy aggregate schemas provided in
 * 'LazySchemas' to prevent recomputation. However, if it's simply being
 * used as 'lazy(() => s)' to define a recursive structure, there is not
 * much of a difference.
 */
export function lazy<T, S>(schema: () => Schema<T, S>): Schema<T, S> {
    return {
        encode: (val: T): S => schema().encode(val),
        decode: (data: S): T => schema().decode(data),
        validate: (data: unknown): data is S => schema().validate(data),
    };
}

/**
 * Construct an 'InjectSchema' from its base schema, a function to project
 * the true domain type into the base domain type, and a function to inject
 * some context to make a way to instantiate the true domain type from the
 * base domain type.
 *
 * Somewhat similar to 'contra', but with asymmetrical decoding for context
 * injection.
 */
export function injecting<T, D, B, S>(
    baseSchema: Schema<B, S>,
    project: (val: T) => B,
    inject: (context: D) => (base: B) => T,
): InjectSchema<T, D, B, S> {
    return {
        encode: val => baseSchema.encode(val),
        decode: data => baseSchema.decode(data),
        validate: (data: unknown): data is S => baseSchema.validate(data),
        project,
        inject,
    };
}

/**
 * The most basic schema, which accepts anything and validates everything
 */
export const anAny: Schema<any, any> = primitive((_data: unknown): _data is any => true);

/**
 * Trivial 'Schema' for 'string'.
 */
export const aString: Schema<string, string> = primitive((data: unknown): data is string => {
    return typeof data === "string";
});

/**
 * Trivial 'Schema' for 'number'.
 */
export const aNumber: Schema<number, number> = primitive((data: unknown): data is number => {
    return typeof data === "number";
});

/**
 * Trivial 'Schema' for 'boolean'.
 */
export const aBoolean: Schema<boolean, boolean> = primitive((data: unknown): data is boolean => {
    return typeof data === "boolean";
});

/**
 * Trivial 'Schema' for 'null'.
 */
export const aNull: Schema<null, null> = primitive((data: unknown): data is null => {
    return data === null;
});

/**
 * Trivial 'Schema' for 'undefined'.
 *
 * WARNING: Note that 'undefined' is not always safe to use in JSON, such as
 * in an array. It can be used as the key of an object, however; see
 * 'optional'. If you need an array of values that could be undefined, use
 * 'union(aNull, anUndefined)' instead.
 */
export const anUndefined: Schema<undefined, undefined> = primitive((data: unknown): data is undefined => {
    return typeof data === "undefined";
});

/**
 * Construct a schema for arrays, given a schema for their elements.
 *
 * WARNING: 'undefined' will turn into 'null' in an array in JSON. If you
 * want an array of values that could be undefined, use 'union(aNull,
 * anUndefined)' instead.
 */
export function arrayOf<T, S>(elementsSchema: Schema<T, S>): Schema<T[], S[]> {
    return {
        encode: (arr: T[]) => arr.map(x => elementsSchema.encode(x)),
        decode: (arr: S[]) => arr.map(x => elementsSchema.decode(x)),
        validate: (data: unknown): data is S[] => {
            if (!Array.isArray(data)) {
                return false;
            }
            return data.every(x => elementsSchema.validate(x));
        },
    };
}

export function nonEmptyArrayOf<T, S>(elementsSchema: Schema<T, S>): Schema<NonEmptyArray<T>, NonEmptyArray<S>> {
    const { encode, decode, validate } = arrayOf(elementsSchema);
    return {
        encode: encode as (value: NonEmptyArray<T>) => NonEmptyArray<S>,
        decode: decode as (data: NonEmptyArray<S>) => NonEmptyArray<T>,
        validate: (data: unknown): data is NonEmptyArray<S> => {
            return Array.isArray(data) && data.length >= 1 && validate(data);
        },
    };
}

export function tupleOf<
    // The structure of the encoded tuple
    R extends Schema<unknown, unknown>[],
>(...elementSchemas: R): Schema<RecordDomains<R>, RecordReprs<R>> {
    return {
        encode: (tup: RecordDomains<R>) => {
            return tup.map((x, i) => elementSchemas[i].encode(x)) as RecordReprs<R>;
        },
        decode: (tup: RecordReprs<R>) => {
            return tup.map((x, i) => elementSchemas[i].decode(x)) as RecordDomains<R>;
        },
        validate: (data: unknown): data is RecordReprs<R> => {
            if (!Array.isArray(data) || data.length !== elementSchemas.length) {
                return false;
            }
            return elementSchemas.every((schema, i) => schema.validate(data[i]));
        }
    };
}

/**
 * Trivial schema for empty array/tuple, the identity under tuple/array
 * concatenation.
 */
export const anEmptyArray: Schema<[], []> = tupleOf();

/**
 * Encodes a raw object by encoding its keys.
 */
export function object<V, R>(values: Schema<V, R>): Schema<Record<PrimKey, V>, Record<PrimKey, R>> {
    return {
        encode: (val: Record<PrimKey, V>): Record<PrimKey, R> => {
            const acc: Record<PrimKey, R> = {};
            for (const k in val) {
                acc[k] = values.encode(val[k]);
            }
            return acc;
        },
        decode: (data: Record<PrimKey, R>): Record<PrimKey, V> => {
            const acc: Record<PrimKey, V> = {};
            for (const k in data) {
                acc[k] = values.decode(data[k]);
            }
            return acc;
        },
        validate: (data: unknown): data is Record<PrimKey, R> => {
            if (typeof data !== "object" || data === null) {
                return false;
            }
            const obj = data as Record<PrimKey, unknown>;
            for (const k in obj) {
                if (!values.validate(obj[k])) {
                    return false;
                }
            }
            return true;
        },
    };
}

/**
 * Encodes an ES6 'Map'. We unfortunately cannot encode it as an object,
 * since a 'Map' is strictly more flexible; for example, `0` and `"0"` are
 * considered different keys in a 'Map', but the same key in an object.
 *
 * When decoding, if the same key is present multiple times, the last
 * occurrence's value will be kept.
 */
export function map<K, V, KR, VR>(keys: Schema<K, KR>, values: Schema<V, VR>): Schema<Map<K, V>, [KR, VR][]> {
    return {
        encode: (val: Map<K, V>): [KR, VR][] => {
            const acc: [KR, VR][] = [];
            for (const entry of val.entries()) {
                acc.push([keys.encode(entry[0]), values.encode(entry[1])]);
            }
            return acc;
        },
        decode: (data: [KR, VR][]): Map<K, V> => {
            const acc: Map<K, V> = new Map();
            for (const entry of data) {
                acc.set(keys.decode(entry[0]), values.decode(entry[1]));
            }
            return acc;
        },
        validate: (data: unknown): data is [KR, VR][] => {
            return arrayOf(tupleOf(keys, values)).validate(data);
        },
    };
}

/**
 * Encodes an ES6 'Set'. The set is simply encoded as an array of the
 * representation type.
 *
 * When decoding, if the same value is present multiple times, the results
 * will be the same as a call to the 'Set' constructor.
 */
export function set<T, S>(schema: Schema<T, S>): Schema<Set<T>, S[]> {
    return {
        encode: (val: Set<T>): S[] => {
            return Array.from(val).map(x => schema.encode(x));
        },
        decode: (data: S[]): Set<T> => {
            return new Set(data.map(x => schema.decode(x)));
        },
        validate: (data: unknown): data is S[] => {
            return arrayOf(schema).validate(data);
        },
    };
}

/**
 * Construct a schema for a given record type, given the structure of the
 * record. For example:
 *
 * <pre><code>
 * type Person = { name: string; age: number; };
 *
 * const personSchema: Schema<Person, { name: string; age: number; }> =
 *     recordOf({
 *         name: aString,
 *         age: aNumber,
 *     });
 * </code></pre>
 */
export function recordOf<
    // The structure of the record
    R extends Record<string, Schema<unknown, unknown>>,
>(structure: R): Schema<RecordDomains<R>, RecordReprs<R>> {
    return {
        encode: (x: RecordDomains<R>) => {
            const obj: Partial<RecordReprs<R>> = {};
            for (const key in structure) {
                obj[key] = structure[key].encode(x[key]) as ReprOf<R[keyof R]>;
            }
            return obj as RecordReprs<R>;
        },
        decode: (obj: RecordReprs<R>) => {
            const res: Partial<RecordDomains<R>> = {};
            for (const key in structure) {
                res[key] = structure[key].decode(obj[key]) as DomainOf<R[keyof R]>;
            }
            return res as RecordDomains<R>;
        },
        validate: (data: unknown): data is RecordReprs<R> => {
            if (typeof data !== "object" || data === null) {
                return false;
            }
            // Assume that data can be properly indexed, though we don't
            // know if the keys exist, or what type the values are. The
            // validator will handle 'undefined' keys. The 'Partial' here is
            // technically redundant, as the 'unknown' already handles the
            // 'undefined' case.
            const obj = data as Partial<Record<keyof R, unknown>>;
            for (const key in structure) {
                const validator = structure[key];
                if (!validator.validate(obj[key])) {
                    return false;
                }
            }
            return true;
        },
    };
}

/**
 * Trivial schema for empty object, the identity under object unions.
 */
export const anEmptyObject: Schema<{}, {}> = recordOf({});

/**
 * Encodes classes into records, like 'recordOf', but with custom
 * reconstruction for class instances, such as using a constructor. When
 * decoding a representation, the values of the representation will first be
 * recursively decoded, and then 'reconstruct' will be applied to the result
 * to make the new instance. For example:
 *
 * <pre><code>
 * class Person {
 *     constructor(
 *         private name: string,
 *         private age: number,
 *     ) {}
 * }
 *
 * const personSchema: Schema<Person, { name: string; age: number; }> =
 *     classOf({
 *         name: aString,
 *         age: aNumber,
 *     }, ({ name, age }) => new Person(name, age));
 * </code></pre>
 */
export function classOf<
    // The structure of the encoded record
    R extends Record<string, Schema<unknown, unknown>>,
    T extends RecordDomains<R>
>(structure: R, reconstruct: (data: RecordDomains<R>) => T): Schema<T, RecordReprs<R>> {
    return contra(recordOf(structure), id, reconstruct);
}

/**
 * Construct a schema for a type union, given schemas of either type.
 * Additionally requires type predicates in order to be able to determine
 * which schema to use when encoding. If the two types are trivially
 * encodable (they have a 'Schema<T, T>'), consider using 'union' instead.
 * Note that this is left-biased; if both types are the same, for example,
 * the schema on the left will be tried first.
 */
export function unionOf<TL, SL, TR, SR>(
    isLeft: (x: TL | TR) => x is TL,
    isRight: (x: TL | TR) => x is TR,
    left: Schema<TL, SL>,
    right: Schema<TR, SR>,
): Schema<TL | TR, SL | SR> {
    return {
        encode: (x: TL | TR) => {
            if (isLeft(x)) {
                return left.encode(x);
            } else if (isRight(x)) {
                return right.encode(x);
            } else {
                return impossible(x);
            }
        },
        decode: (data: SL | SR) => {
            if (left.validate(data)) {
                return left.decode(data);
            } else if (right.validate(data)) {
                return right.decode(data);
            } else {
                return impossible(data);
            }
        },
        validate: (data: unknown): data is SL | SR => {
            return left.validate(data) || right.validate(data);
        },
    };
}

/**
 * Like 'unionOf', but for schemas in which at least one of the types in
 * the union trivially encodes to the same type, since they already have
 * built-in validation. If only one of the types is trivial, it must go on
 * the left. For example:
 *
 * <pre><code>
 * const numberOrStringSchema: Schema<number | string, number | string> =
 *     union(aNumber, aString);
 * </code></pre>
 *
 * Like 'unionOf', this is left-biased; the left schema will apply in the
 * case where both schemas would validate a value.
 */
export function union<TL, TR, SR>(left: Schema<TL, TL>, right: Schema<TR, SR>): Schema<TL | TR, TL | SR> {
    return unionOf(
        (x: TL | TR): x is TL => left.validate(x),
        (x: TL | TR): x is TR => !left.validate(x),
        left,
        right,
    );
}

/**
 * Allows the schema to be undefined. In 'recordOf', this can be used to
 * make a field optional:
 *
 * <pre><code>
 * const schema = recordOf({ x: optional(aNumber) });
 * schema.validate({ x: 1 });         // true
 * schema.validate({ x: "hello" });   // false
 * schema.validate({ x: undefined }); // true
 * schema.validate({});               // true
 * </code></pre>
 *
 * WARNING: If serializing to JSON, this can only safely be used on the
 * values of an object, as 'undefined' will convert to 'null' in JSON
 * arrays, and will fail to parse as a top-level value.
 */
export function optional<T, S>(schema: Schema<T, S>): Schema<undefined | T, undefined | S> {
    return union(anUndefined, schema);
}

/**
 * Extends a schema's validation to apply additional restrictions to the
 * representation type after initial validation. For example:
 *
 * <pre><code>
 * const positive: Schema<number, number> = constrain(aNumber, x => x > 0);
 * </code></pre>
 */
export function constrain<T, S>(schema: Schema<T, S>, predicate: (x: S) => boolean): Schema<T, S> {
    return {
        encode: x => schema.encode(x),
        decode: x => schema.decode(x),
        validate: (x): x is S => schema.validate(x) && predicate(x),
    };
}

/**
 * Like 'constrain', but uses a type predicate to narrow the
 * representational type. For example, this can be used to narrow the
 * representational type of a string schema that is more specifically a set
 * of keys of another type, by 'in' to make a type predicate.
 */
export function asserting<T, R, S extends R>(schema: Schema<T, R>, predicate: (x: R) => x is S): Schema<T, S> {
    // We can decay type predicates to boolean constraints
    return constrain(schema, predicate) as Schema<T, S>;
}

/**
 * Restrict a string schema to only strings matching a regular expression.
 * The match is conducted via 'RegExp.prototype.test'. To ensure that the
 * entire string matches the regex, use <code>/^regex$/</code>.
 */
export function matching(regex: RegExp): Schema<string, string> {
    return constrain(aString, s => regex.test(s));
}

/**
 * Construct a schema that encodes a value by its index in an array of
 * possible values. This is a somewhat unsafe combinator, since any
 * unrecognized value will throw an error. Furthermore, encoding requires an
 * O(n) lookup via an 'indexOf', which is not performance optimal. This is
 * also brittle, since changing the order of array elements can break the
 * decoding if your data is persistent. Only use this when you know what
 * you're doing.
 */
export function indexing<T>(values: T[]): Schema<T, number> {
    return contra(
        constrain(aNumber, x => x >= 0 && x < values.length),
        (x: T): number => {
            const ix = values.indexOf(x);
            if (ix < 0) {
                throw new Error(`augustus: attempted to encode ${x} by index in ${values}`);
            }
            return ix;
        },
        (x: number): T => values[x],
    );
}

// TODO: restrict the keys to a 'K extends string' set; figure out a good
// way to do a 'K extends S => Schema<S, S> -> Schema<K, K>', since
// 'asserting' can only map the representational type
/**
 * Like 'indexing', except use an object mapping string values instead of an
 * array with indices. All of the same restrictions and warnings apply.
 */
export function mapping<T>(values: Record<string, T>): Schema<T, string> {
    return contra(
        constrain(aString, s => s in values),
        (val: T): string => {
            for (const k in values) {
                if (values[k] === val) {
                    return k;
                }
            }
            throw new Error(`augustus: attempted to encode ${val} by key in ${values}`);
        },
        (key: string): T => values[key],
    );
}

/**
 * If a type is discriminated by some key, given a record of values
 * associated with that key, use the key to discriminate on the type. This
 * is useful for discriminated unions, where each branch of the union has a
 * different literal type for some discriminating key. Note that this
 * currently usually needs an explicit type declaration on the schema to
 * figure out the domain and representation types.
 */
export function discriminating<
    T extends Record<D, PrimKey>,
    S extends Record<D, T[D]>,
    // the discriminating key, in the domain and representation types
    D extends keyof T & keyof S,
>(discriminant: D, schemas: Record<T[D], Schema<T, S>>): Schema<T, S> {
    return {
        encode: (x: T): S => {
            return schemas[x[discriminant]].encode(x);
        },
        decode: (x: S): T => {
            // TypeScript needs coercion here to figure out that the types
            // are equal, T[D] = S[D]
            const t = x[discriminant] as unknown as T[D];
            return schemas[t].decode(x);
        },
        validate: (data: unknown): data is any => {
            if (typeof data !== "object" || data === null) {
                return false;
            }
            const discriminantValue = (data as any)[discriminant] as T[D] | undefined;
            if (discriminantValue === undefined) {
                return false;
            }
            const schema = schemas[discriminantValue] as Schema<T, S> | undefined;
            if (schema) {
                return schema.validate(data);
            } else {
                return false;
            }
        },
    };
}

/**
 * 'Schema' for 'BigInt'. JSON and other formats don't support 'BigInt's, so we
 * just serialize it as a string instead. If your target does support 'BigInt's,
 * you can use 'primitive' to make a trivial combinator for it.
 */
export const aBigInt: Schema<BigInt, string> = contra(
    constrain(aString, x => {
        try {
            BigInt(x);
            return true;
        } catch (e) {
            return false;
        }
    }),
    (x: BigInt): string => x.toString(),
    (data: string): BigInt => BigInt(data),
);

