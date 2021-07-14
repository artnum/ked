# ked DB

ked is based around LDAP.

## Structure

A document (kedDocument) is composed of any number of entry (kedEntry). An entry is a unit of a single type. An image in a document would be an entry. An entry have history represented by an other related entry with its attribute kedNext set to the current entry.

-+-[kedDocument](1)-+
 |                  +-[kedEntry](1)<kedNext:1>
 |                  +-[kedEntry](1)
 |                  +-[kedEntry](2)
 |                  +-[kedEntry](3)<kedNext:3>
 |                  +-[kedEntry](3)
 |                  +-...
 +-[kedDocument](2)-+
 |                  +-[kedEntry](1)
 |                  +-...
 +-...

Updated version keep the same id. From the ldap point of view, the rdn is build with kedId=<id>+kedTimestamp=<time>

## Task

Any kedDocument can be turned into a task by adding the object class kedTask. A task can have more attributes. A task might be processed differently by the application.

An entry is not supposed to be turned into a task. But there is no objective reason to not do it. Except, maybe, that it makes no sense to have, for example, a picture set as a task (maybe if you write a texte, turn it into a picture and then it may start to have a sense ... but it makes no sense to do that). So, from the backend point of view, there is no limitation to turn an entry into a task.

## Event

Any kedDocument can be turned into an event by adding the object class kedDocument. Nothing is clearly defined or implemented yet, just something that would be done.

### Presentation

No mechanism related to presentation is available. It's up to the application to set values as needed to have a reproducible reprensentation.

## Creating an update

Updating an entry happend in two writes :

  * Create the new entry
  * Modify the previous entry to have it kedNext pointing the new one

This operation might need some locking mechanism.

## Creating a document

Creating a new document consist of creating an kedDocument and then adding some kedEntry. The document is identified, by the user, by its name. There's no limit (at least only ldap implementation limits) on how many number of name a document can have.

## Fetching a document

A document is found by its name and then all kedEntry having no kedNext attribute are fetched to build the document.

If an implementation store only delta between version, it has to recompose the end document from deltas.

## Deleting a document

A document is deleted by having its attribute kedDelete set to the current time. A deleted document can be recovered and an external mechanism of purging database from old deleted document can be set.

## Creation and modification time

If creation time is set by kedTimestamp, modification can be tricky. With features like "auto-save", one modification can happen through several modification over time. Having each "auto-save" iteration as an historic version of the document might not be wanted. Thus kedModified is there to offer that kind of support.
It can also be used to have a control over simultaneous modification of the content. 

# Tags

Tag is a well known system. You tag something and search by tags. Here we just add the ability to tag a tag. So if you create a tag "Project" which you want to use to tag all document about any projects, but you also want to create a tag for each project with the project name. By tagging the tag "project name" with the tag "Project" you achieve this structure.

## ACL

ACL are enforced through tag, people have access to item based on their tag.

ACL set an access to an object, be it "access", "create", "delete" and others actions that have yet to be defined. When defining an ACL, it checks ownership and apply default ownership ACL. Then it goes through tag of the object, it searches for the user or group of user associated, via acl object related to the tag, to build a list of actions.

The list of action contains either positive or negative action "access" set the right to access, "-access" remove the right to access. The list of action is solved by adding all action matching the user, through different tags, and then adding all the positive action (once for each action). Once all positive action are set, it starts to remove negative action. Action left are what is allowed. So you can have ACL made to remove action only.
You have short names (like everything) that expand into a set of several actions.

Remember, owner of an object (an object with kedUser set to the user), don't go through the tag related check.

There is a third decision part for object with no tags and no user : default. Its a set of action, set by configuration, that are applied when no ACL can be applied to the object.

As tags are tagged, and all get the default "root" tag, you can build ACL in hiearchical way. A positive approach could be to add everything to root tag and then restrict on subsequent tags or do the reverse, nothing on root tag (so no ACL, -everything will disallow everything for everyone except creator), and add up down the road.

The document root has is dn considered as a tag and has no owner. So ACL for document root need to be set before hand.


### Example

  tag1 : access delete archive
  tag2 : -delete
  tag3 : -archive
  tag4 : archive
    =>   access, delete, archive, -delete, -archive, archive
    ==>  access, delete, archive, -delete, -archive
    ===> access

  tag1: everything
  tag2: -delete
    =>   everything, -delete
    ==>  access, create, create:sub, create:entry, ..., delete, -delete
    ===> access, create, create:sub, create:entry, ...

## Resolving ACL membership

When an ACL is created, relative to a tag, members are added. The system will try to match the member to a user by its id or user id. If not, it will look for typical LDAP groups and try to match with thoses groups.



Some role based might be added.