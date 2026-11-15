import api from '../../services/api'
import type { User } from '../../types'

export type { User }

export const getUsers = async (): Promise<User[]> => {
  const response = await api.get<User[]>('/users')
  return response.data
}
