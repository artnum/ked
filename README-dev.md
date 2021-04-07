# ked dev

In order to develop ked, an openldap configuration is provided. It allows to start an openldap server on 127.0.0.1:9090 with everything needed to work with ked. The tree suffix is o=ked. To access the tree with all privileges, the user is cn=admin,o=ked with password 1234.

The directory configuration is accessible on cn=config with admin cn=config and password 1234. Needless to say that 1234 is not a password recommanded to use in production.

When starting the server, it runs under current users and store everything under /tmp/ked. When stopping the server "sh stop.sh" under test/slapd, the database is dumped into populate.ldif before being removed from /tmp. When starting the server, via "sh run.sh", the database is reloaded. The run.sh call stop.sh. The file populate.ldif is overwritten by "stop.sh", so if you corrupt you directory, copy populate.ldif before "stop.sh"

If you make change to the schema, doc/schema/ked.ldif, remove populate.ldif as the change might not allow to load its content into the directory. Anyway if it fails to populate, the directory would be empty so it doesn't matter.

## Install

### About this procedure

This procedure is set according that my ldap server is available via unix socket and that `root` user have full access to the tree. I can use `EXTERNAL` mechanism to authenticate against the tree and do configuration needed.

### PHP module

  * imagick
  * sodium (php < 7.2)

### Procedure

Clone repository into web server folder

```shell  
user@webserver:/www$ git clone https://github.com/artnum/ked.git
```

Add the schema to ldap server, something like (depends on your ldap server configuration) :

```shell
user@webserver:/www$ cd ked
user@webserver:/www/ked$ sudo ldapadd -H ldapi:/// -Y EXTERNAL -f docs/schema/ked.ldif
```

Based on your configuration, create the root of your ldap tree and add it to your ldap server (read `test/slapd/conf/init.ldif` to see how it should look like). According my ldif file is at `~/ked-init.ldif` :

```shell
user@webserver:/www/ked$ sudo ldapadd -H ldapi:/// -Y EXTERNAL -f ~/ked-init.ldif
```

Edit `web/index.php` to set ldap base dn (the one just added above), ldap server uri, username and password. Also set the folder where you want to store uploaded files.

In `app`, run yarn to install npm packages :

```shell
user@webserver:/www/ked$ cd app
user@webserver:/www/ked$ yarn
```

It should be ready to run.

## Things to check

  * `upload_max_filesize` and `post_max_size` set big enough for files you want to allow. If it differs in a way that `upload_max_filesize` is much smaller than `post_max_size`, you will see errors like : `PHP Warning:  fopen(): Filename cannot be empty in /srv/apache/ked/src/php/ked-high.php on line 53` while uploading a file that fits into `post_max_size` but not in `upload_max_filesize`.