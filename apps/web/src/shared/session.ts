const NAME_KEY = "kultroom:name";
const USER_KEY = "kultroom:user-id";
export const session = {
  name: () => sessionStorage.getItem(NAME_KEY) || "",
  setName: (value: string) => sessionStorage.setItem(NAME_KEY, value),
  userId: () => {
    let id = sessionStorage.getItem(USER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(USER_KEY, id);
    }
    return id;
  },
};
