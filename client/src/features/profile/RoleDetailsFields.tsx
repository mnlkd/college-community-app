import {
  EXPECTED_GRADUATION_YEARS_AHEAD,
  GRADUATION_YEAR_MIN,
  PROFILE_DETAIL_MAX,
  PROGRAMMES,
  programmeSchema,
  type Programme,
  type Role,
} from '@hilcoe/shared'
import { isApiError } from '../../api'
import { PROGRAMME_LABELS } from '../../design/content'
import { Field, Select, TextInput } from '../../design/ui'

/** Form state of the role-specific profile fields; years are kept as select values. */
export interface RoleDetailsValues {
  programme: string
  graduationYear: string
  studyOrExpertise: string
  currentPosition: string
}

export const emptyRoleDetails: RoleDetailsValues = {
  programme: '',
  graduationYear: '',
  studyOrExpertise: '',
  currentPosition: '',
}

export function roleDetailsValues(source: {
  programme?: Programme | null
  graduationYear?: number | null
  studyOrExpertise?: string | null
  currentPosition?: string | null
}): RoleDetailsValues {
  return {
    programme: source.programme ?? '',
    graduationYear: source.graduationYear ? String(source.graduationYear) : '',
    studyOrExpertise: source.studyOrExpertise ?? '',
    currentPosition: source.currentPosition ?? '',
  }
}

/** The request fields for a role; Staff send no programme or graduation year. */
export function roleDetailsInput(role: Role, values: RoleDetailsValues) {
  const staff = role === 'STAFF'
  const programme = programmeSchema.safeParse(values.programme)
  return {
    programme: staff || !programme.success ? null : programme.data,
    graduationYear: staff || values.graduationYear === '' ? null : Number(values.graduationYear),
    studyOrExpertise: values.studyOrExpertise,
    currentPosition: values.currentPosition,
  }
}

export function yearOptions(role: Role, currentYear: number): number[] {
  if (role === 'STUDENT') {
    return Array.from({ length: EXPECTED_GRADUATION_YEARS_AHEAD + 1 }, (_, index) => currentYear + index)
  }
  return Array.from({ length: currentYear - GRADUATION_YEAR_MIN + 1 }, (_, index) => currentYear - index)
}

/** Field messages from a 422 answer, or null for any other failure. */
export function fieldErrorsOf(error: unknown): Record<string, string> | null {
  return isApiError(error) && error.fields ? { ...error.fields } : null
}

export function RoleDetailsFields({
  role,
  values,
  errors,
  onChange,
  currentYear,
  showStudy = false,
}: {
  role: Role
  values: RoleDetailsValues
  errors: Record<string, string | undefined>
  onChange: (values: RoleDetailsValues) => void
  currentYear: number
  /** Students and Alumni may add a field of study when editing their profile. */
  showStudy?: boolean
}) {
  const set = (key: keyof RoleDetailsValues) => (value: string) => onChange({ ...values, [key]: value })
  const hint = `At most ${PROFILE_DETAIL_MAX} characters.`
  if (role === 'STAFF') {
    return (
      <>
        <Field label="Department or area of expertise" required hint={hint} error={errors.studyOrExpertise}>
          <TextInput
            name="studyOrExpertise"
            value={values.studyOrExpertise}
            invalid={Boolean(errors.studyOrExpertise)}
            onChange={(event) => set('studyOrExpertise')(event.target.value)}
          />
        </Field>
        <Field label="Position" required hint={hint} error={errors.currentPosition}>
          <TextInput
            name="currentPosition"
            value={values.currentPosition}
            invalid={Boolean(errors.currentPosition)}
            onChange={(event) => set('currentPosition')(event.target.value)}
          />
        </Field>
      </>
    )
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Programme" required error={errors.programme}>
          <Select
            name="programme"
            value={values.programme}
            invalid={Boolean(errors.programme)}
            onChange={(event) => set('programme')(event.target.value)}
          >
            <option value="">Choose…</option>
            {PROGRAMMES.map((value) => (
              <option key={value} value={value}>
                {PROGRAMME_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={role === 'STUDENT' ? 'Expected graduation year' : 'Graduation year'}
          required
          error={errors.graduationYear}
        >
          <Select
            name="graduationYear"
            value={values.graduationYear}
            invalid={Boolean(errors.graduationYear)}
            onChange={(event) => set('graduationYear')(event.target.value)}
          >
            <option value="">Choose…</option>
            {yearOptions(role, currentYear).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {showStudy && (
        <Field label="Field of study or expertise" hint={`Optional. ${hint}`} error={errors.studyOrExpertise}>
          <TextInput
            name="studyOrExpertise"
            value={values.studyOrExpertise}
            invalid={Boolean(errors.studyOrExpertise)}
            onChange={(event) => set('studyOrExpertise')(event.target.value)}
          />
        </Field>
      )}
      <Field label="Current position" hint={`Optional. ${hint}`} error={errors.currentPosition}>
        <TextInput
          name="currentPosition"
          value={values.currentPosition}
          invalid={Boolean(errors.currentPosition)}
          onChange={(event) => set('currentPosition')(event.target.value)}
        />
      </Field>
    </>
  )
}
