export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface Invitation {
  id: string;
  email: string;
  status: "sent";
}

export interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  contactEmail: string;
  status: "submitted";
}

export interface Preferences {
  emailNotifications: boolean;
  productUpdates: boolean;
}

export interface AccountSettings {
  displayName: string;
  email: string;
  phone: string;
  preferences: Preferences;
}

export interface AuthenticatedUser {
  email: string;
  displayName: string;
}

export interface CreateCustomerInput {
  name: string;
  email: string;
  phone: string;
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string;
  phone?: string;
}

export interface UpdateSettingsInput {
  displayName?: string;
  email?: string;
  phone?: string;
  preferences?: Partial<Preferences>;
}

export class DemoStore {
  readonly #customers = new Map<string, Customer>();
  readonly #invitations: Invitation[] = [];
  readonly #supportTickets: SupportTicket[] = [];
  #settings: AccountSettings = {
    displayName: "Demo User",
    email: "",
    phone: "",
    preferences: {
      emailNotifications: true,
      productUpdates: false,
    },
  };
  #authenticatedUser: AuthenticatedUser | undefined;
  #nextCustomerId = 1;
  #nextInvitationId = 1;
  #nextSupportTicketId = 1;

  listCustomers(): Customer[] {
    return Array.from(this.#customers.values(), (customer) => ({ ...customer }));
  }

  searchCustomers(query: string): Customer[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    if (normalizedQuery.length === 0) {
      return this.listCustomers();
    }

    return this.listCustomers().filter((customer) =>
      [customer.name, customer.email, customer.phone].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      ),
    );
  }

  getCustomer(id: string): Customer | undefined {
    const customer = this.#customers.get(id);
    return customer === undefined ? undefined : { ...customer };
  }

  createCustomer(input: CreateCustomerInput): Customer {
    const customer: Customer = {
      id: String(this.#nextCustomerId++),
      ...input,
    };
    this.#customers.set(customer.id, customer);
    return { ...customer };
  }

  updateCustomer(id: string, input: UpdateCustomerInput): Customer | undefined {
    const current = this.#customers.get(id);

    if (current === undefined) {
      return undefined;
    }

    const updated = { ...current, ...input };
    this.#customers.set(id, updated);
    return { ...updated };
  }

  createInvitation(email: string): Invitation {
    const invitation: Invitation = {
      id: String(this.#nextInvitationId++),
      email,
      status: "sent",
    };
    this.#invitations.push(invitation);
    return { ...invitation };
  }

  listInvitations(): Invitation[] {
    return this.#invitations.map((invitation) => ({ ...invitation }));
  }

  createSupportTicket(input: Omit<SupportTicket, "id" | "status">): SupportTicket {
    const ticket: SupportTicket = {
      id: String(this.#nextSupportTicketId++),
      ...input,
      status: "submitted",
    };
    this.#supportTickets.push(ticket);
    return { ...ticket };
  }

  listSupportTickets(): SupportTicket[] {
    return this.#supportTickets.map((ticket) => ({ ...ticket }));
  }

  getSettings(): AccountSettings {
    return {
      ...this.#settings,
      preferences: { ...this.#settings.preferences },
    };
  }

  updateSettings(input: UpdateSettingsInput): AccountSettings {
    this.#settings = {
      ...this.#settings,
      ...input,
      preferences: {
        ...this.#settings.preferences,
        ...input.preferences,
      },
    };
    return this.getSettings();
  }

  login(email: string): AuthenticatedUser {
    this.#authenticatedUser = {
      email,
      displayName: this.#settings.displayName,
    };
    return { ...this.#authenticatedUser };
  }

  logout(): void {
    this.#authenticatedUser = undefined;
  }

  getAuthenticatedUser(): AuthenticatedUser | undefined {
    return this.#authenticatedUser === undefined ? undefined : { ...this.#authenticatedUser };
  }
}

export const createDemoStore = (): DemoStore => new DemoStore();
