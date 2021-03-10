# ked dev

In order to develop ked, an openldap configuration is provided. It allows to start an openldap server on 127.0.0.1:9090 with everything needed to work with ked. The tree suffix is o=ked. To access the tree with all privileges, the user is cn=admin,o=ked with password 1234.

The directory configuration is accessible on cn=config with admin cn=config and password 1234. Needless to say that 1234 is not a password recommanded to use in production.

When starting the server, it runs under current users and store everything under /tmp/ked. When stopping the server "sh stop.sh" under test/slapd, the database is dumped into populate.ldif before being removed from /tmp. When starting the server, via "sh run.sh", the database is reloaded. The run.sh call stop.sh. The file populate.ldif is overwritten by "stop.sh", so if you corrupt you directory, copy populate.ldif before "stop.sh"

If you make change to the schema, doc/schema/ked.ldif, remove populate.ldif as the change might not allow to load its content into the directory. Anyway if it fails to populate, the directory would be empty so it doesn't matter.